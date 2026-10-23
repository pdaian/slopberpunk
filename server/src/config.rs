// Listener and thread configuration. GPL-3.0-or-later.
use axum::http::Uri;
use std::{io, net::SocketAddr};

pub(super) struct Config {
    pub bind: SocketAddr,
    pub origins: Option<Vec<String>>,
    pub secure: bool,
    pub workers: usize,
    pub shards: usize,
}

impl Config {
    pub fn load() -> io::Result<Self> {
        Self::parse(
            |name| match std::env::var(name) {
                Ok(value) => Ok(Some(value)),
                Err(std::env::VarError::NotPresent) => Ok(None),
                Err(_) => Err(invalid(format!("{name} must be valid Unicode"))),
            },
            std::thread::available_parallelism()
                .map(usize::from)
                .unwrap_or(1),
        )
    }

    fn parse(get: impl Fn(&str) -> io::Result<Option<String>>, cores: usize) -> io::Result<Self> {
        let bind: SocketAddr = if let Some(address) = get("SLOPERBERPUNK_BIND")? {
            address
                .parse()
                .map_err(|_| invalid("SLOPERBERPUNK_BIND must be an IP:port address"))?
        } else {
            let host = get("HOST")?.unwrap_or_else(|| "0.0.0.0".into());
            let port = get("PORT")?.unwrap_or_else(|| "8080".into());
            SocketAddr::new(
                host.parse()
                    .map_err(|_| invalid("HOST must be an IPv4 or IPv6 address"))?,
                port.parse()
                    .map_err(|_| invalid("PORT must be an integer from 1 to 65535"))?,
            )
        };
        if bind.port() == 0 {
            return Err(invalid("The listener port must be from 1 to 65535"));
        }
        let secure = match get("SLOPERBERPUNK_SECURE")?.as_deref().unwrap_or("0") {
            "0" => false,
            "1" => true,
            _ => return Err(invalid("SLOPERBERPUNK_SECURE must be 0 or 1")),
        };
        let origins = get("SLOPERBERPUNK_ORIGINS")?
            .map(|value| {
                value
                    .split(',')
                    .map(normalize_origin)
                    .collect::<io::Result<Vec<_>>>()
            })
            .transpose()?;
        let workers = count(
            get("SLOPERBERPUNK_WORKERS")?,
            cores.clamp(1, 4),
            "SLOPERBERPUNK_WORKERS",
        )?;
        // Reserve room for networking and the expedition thread on larger hosts.
        let shards = count(
            get("SLOPERBERPUNK_SHARDS")?,
            cores.saturating_sub(workers + 1).clamp(1, 64),
            "SLOPERBERPUNK_SHARDS",
        )?;
        Ok(Self {
            bind,
            origins,
            secure,
            workers,
            shards,
        })
    }
}

fn invalid(message: impl Into<String>) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, message.into())
}

fn count(value: Option<String>, default: usize, name: &str) -> io::Result<usize> {
    let value = match value {
        Some(value) => value
            .parse::<usize>()
            .map_err(|_| invalid(format!("{name} must be an integer from 1 to 64")))?,
        None => default,
    };
    if !(1..=64).contains(&value) {
        return Err(invalid(format!("{name} must be an integer from 1 to 64")));
    }
    Ok(value)
}

pub(super) fn normalize_origin(value: &str) -> io::Result<String> {
    let uri = value
        .trim()
        .parse::<Uri>()
        .map_err(|_| invalid("SLOPERBERPUNK_ORIGINS must contain HTTP(S) origins"))?;
    let scheme = uri.scheme_str().filter(|s| matches!(*s, "http" | "https"));
    let authority = uri.authority().filter(|a| !a.as_str().contains('@'));
    let (Some(scheme), Some(authority)) = (scheme, authority) else {
        return Err(invalid(
            "SLOPERBERPUNK_ORIGINS must contain HTTP(S) origins without credentials",
        ));
    };
    if !matches!(uri.path(), "" | "/") || uri.query().is_some() || value.contains('#') {
        return Err(invalid(
            "SLOPERBERPUNK_ORIGINS cannot contain paths, queries, or fragments",
        ));
    }
    let default_port = if scheme == "https" { 443 } else { 80 };
    let host = authority.host();
    if host.is_empty() {
        return Err(invalid("SLOPERBERPUNK_ORIGINS must include a host"));
    }
    let port = match &authority.as_str()[host.len()..] {
        "" => default_port,
        suffix => suffix
            .strip_prefix(':')
            .and_then(|s| s.parse::<u16>().ok())
            .filter(|port| *port != 0)
            .ok_or_else(|| invalid("SLOPERBERPUNK_ORIGINS contains an invalid port"))?,
    };
    let host = host.to_lowercase();
    Ok(if port == default_port {
        format!("{scheme}://{host}")
    } else {
        format!("{scheme}://{host}:{port}")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(values: &[(&str, &str)], cores: usize) -> io::Result<Config> {
        Config::parse(
            |name| {
                Ok(values
                    .iter()
                    .find(|(key, _)| *key == name)
                    .map(|(_, value)| (*value).into()))
            },
            cores,
        )
    }

    #[test]
    fn listener_defaults_and_port_80_use_same_origin_requests() {
        let default = config(&[], 8).unwrap();
        assert_eq!(default.bind, "0.0.0.0:8080".parse::<SocketAddr>().unwrap());
        assert!(!default.secure);
        assert!(default.origins.is_none());
        let port_80 = config(&[("PORT", "80")], 8).unwrap();
        assert_eq!(port_80.bind.port(), 80);
        assert!(port_80.origins.is_none());
    }

    #[test]
    fn explicit_bind_wins_and_ipv6_works() {
        let c = config(
            &[
                ("PORT", "80"),
                ("HOST", "invalid"),
                ("SLOPERBERPUNK_BIND", "[::1]:8080"),
            ],
            1,
        )
        .unwrap();
        assert_eq!(c.bind, "[::1]:8080".parse::<SocketAddr>().unwrap());
        assert_eq!((c.workers, c.shards), (1, 1));
        assert!(c.origins.is_none());
    }

    #[test]
    fn origins_are_exact_and_normalized_for_browser_requests() {
        let c = config(
            &[(
                "SLOPERBERPUNK_ORIGINS",
                "https://game.example:443/, http://localhost:80",
            )],
            8,
        )
        .unwrap();
        assert_eq!(
            c.origins.unwrap(),
            ["https://game.example", "http://localhost"]
        );
        for origin in [
            "",
            "*",
            "null",
            "ftp://host",
            "https://user@host",
            "https://host/path",
            "https://host?x=1",
            "https://host#fragment",
            "http://host:abc",
            "http://host:",
            "http://host:65536",
            "http://host:0",
            "http://:80",
        ] {
            assert!(
                config(&[("SLOPERBERPUNK_ORIGINS", origin)], 8).is_err(),
                "{origin}"
            );
        }
    }

    #[test]
    fn invalid_configuration_fails_instead_of_falling_back() {
        for port in ["", "0", "65536", "abc", "-1"] {
            assert!(config(&[("PORT", port)], 8).is_err());
        }
        for name in ["SLOPERBERPUNK_WORKERS", "SLOPERBERPUNK_SHARDS"] {
            for value in ["0", "65", "abc"] {
                assert!(config(&[(name, value)], 8).is_err());
            }
        }
        assert!(config(&[("SLOPERBERPUNK_BIND", "127.0.0.1:0")], 8).is_err());
        assert!(config(&[("HOST", "invalid")], 8).is_err());
        assert!(config(&[("SLOPERBERPUNK_SECURE", "true")], 8).is_err());
        assert!(
            config(
                &[
                    ("HOST", "0.0.0.0"),
                    ("SLOPERBERPUNK_SECURE", "1"),
                    ("SLOPERBERPUNK_ORIGINS", "https://game.example")
                ],
                8
            )
            .is_ok()
        );
    }

    #[test]
    fn thread_counts_are_configurable_and_bounded() {
        let c = config(&[], 16).unwrap();
        assert_eq!((c.workers, c.shards), (4, 11));
        let c = config(
            &[
                ("SLOPERBERPUNK_WORKERS", "2"),
                ("SLOPERBERPUNK_SHARDS", "8"),
            ],
            16,
        )
        .unwrap();
        assert_eq!((c.workers, c.shards), (2, 8));
        assert_eq!(config(&[], 256).unwrap().shards, 64);
    }
}
