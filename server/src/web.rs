// Same-origin frontend delivery. GPL-3.0-or-later.
use axum::{
    Router,
    body::Body,
    extract::State,
    http::{HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
    routing::get,
};
use std::path::PathBuf;

pub(super) fn routes(client: PathBuf) -> Router {
    Router::new().fallback_service(get(static_file).with_state(client))
}

async fn static_file(State(client): State<PathBuf>, uri: axum::http::Uri) -> Response {
    let route = uri.path();
    let relative = if route == "/" {
        "index.html"
    } else {
        route.strip_prefix('/').unwrap_or(route)
    };
    if relative.starts_with('/')
        || relative.contains('%')
        || relative.contains('\\')
        || relative.split('/').any(|s| s == ".." || s.starts_with('.'))
    {
        return StatusCode::NOT_FOUND.into_response();
    }
    if relative == "LICENSE" {
        return (
            [(header::CONTENT_TYPE, "text/plain; charset=utf-8")],
            include_str!("../../LICENSE"),
        )
            .into_response();
    }
    let path = client.join(relative);
    let allowed = relative == "index.html"
        || relative == "play.html"
        || relative == "landing.css"
        || relative == "style.css"
        || relative.starts_with("data/")
        || relative.starts_with("src/")
        || relative.starts_with("assets/");
    if !allowed {
        return StatusCode::NOT_FOUND.into_response();
    }
    let Ok(path) = tokio::fs::canonicalize(path).await else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !path.starts_with(&client) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let mime = if relative.ends_with(".js") {
        "text/javascript; charset=utf-8"
    } else if relative.ends_with(".json") {
        "application/json; charset=utf-8"
    } else if relative.ends_with(".css") {
        "text/css; charset=utf-8"
    } else if relative.ends_with(".svg") {
        "image/svg+xml"
    } else if relative.ends_with(".html") {
        "text/html; charset=utf-8"
    } else {
        "text/plain; charset=utf-8"
    };
    match tokio::fs::read(path).await {
        Ok(body) => {
            let mut response = Response::new(Body::from(body));
            response
                .headers_mut()
                .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime));
            response
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}
pub(super) async fn security_headers(
    request: axum::extract::Request,
    next: axum::middleware::Next,
) -> Response {
    let is_api = request.uri().path() == "/api" || request.uri().path().starts_with("/api/");
    let mut response = next.run(request).await;
    let h = response.headers_mut();
    h.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    h.insert("referrer-policy", HeaderValue::from_static("same-origin"));
    h.insert("x-frame-options", HeaderValue::from_static("DENY"));
    h.insert("content-security-policy",HeaderValue::from_static("default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'"));
    h.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(if is_api { "no-store" } else { "no-cache" }),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::to_bytes, http::Request};
    use tower::ServiceExt;

    async fn request(method: &str, path: &str) -> Response {
        let client = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../client")
            .canonicalize()
            .unwrap();
        routes(client)
            .layer(axum::middleware::from_fn(security_headers))
            .oneshot(
                Request::builder()
                    .method(method)
                    .uri(path)
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn frontend_and_license_are_served_with_security_headers() {
        for (path, mime, text) in [
            ("/", "text/html; charset=utf-8", "play.html"),
            ("/play.html", "text/html; charset=utf-8", "/src/app.js"),
            ("/landing.css", "text/css; charset=utf-8", "body"),
            ("/style.css", "text/css; charset=utf-8", "body"),
            (
                "/src/app.js",
                "text/javascript; charset=utf-8",
                "./prediction.js",
            ),
            (
                "/src/prediction.js",
                "text/javascript; charset=utf-8",
                "class Prediction",
            ),
            (
                "/data/manifest.json",
                "application/json; charset=utf-8",
                "sloperberpunk-content-manifest",
            ),
            ("/assets/mark.svg", "image/svg+xml", "<svg"),
            (
                "/LICENSE",
                "text/plain; charset=utf-8",
                "GNU GENERAL PUBLIC LICENSE",
            ),
        ] {
            let response = request("GET", path).await;
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(response.headers()[header::CONTENT_TYPE], mime);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.headers()["x-frame-options"], "DENY");
            assert!(
                response.headers()["content-security-policy"]
                    .to_str()
                    .unwrap()
                    .contains("connect-src 'self'")
            );
            let body = to_bytes(response.into_body(), 1_048_576).await.unwrap();
            assert!(std::str::from_utf8(&body).unwrap().contains(text), "{path}");
        }
    }

    #[tokio::test]
    async fn head_preserves_length_and_static_posts_are_rejected() {
        let get = request("GET", "/play.html").await;
        let head = request("HEAD", "/play.html").await;
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(
            head.headers()[header::CONTENT_LENGTH],
            get.headers()[header::CONTENT_LENGTH]
        );
        assert!(
            to_bytes(head.into_body(), 1_048_576)
                .await
                .unwrap()
                .is_empty()
        );
        let post = request("POST", "/play.html").await;
        assert_eq!(post.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(post.headers()[header::ALLOW], "GET,HEAD");
    }

    #[tokio::test]
    async fn private_paths_and_removed_entry_points_are_not_public() {
        for path in [
            "/../Cargo.toml",
            "/.git/config",
            "/data/../src/app.js",
            "/src/%2e%2e/main.rs",
            "/%2fetc/passwd",
            "/src/../../server/data/signing-key.json",
            "/server/Cargo.toml",
            "/src/.secret",
            "/data/",
            "/package.json",
            "/tools/serve.mjs",
            "/src/simulation.js",
        ] {
            assert_eq!(
                request("GET", path).await.status(),
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
        for path in ["/api", "/api/unknown"] {
            let response = request("GET", path).await;
            assert_eq!(response.status(), StatusCode::NOT_FOUND);
            assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        }
    }
}
