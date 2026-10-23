// Shared map route semantics; mirrored by client/src/world.js.
// GPL-3.0-or-later. See LICENSE.
use serde::Deserialize;

#[derive(Clone, Deserialize)]
pub(crate) struct Route {
    pub start: [f64; 3],
    pub end: [f64; 3],
    pub width: f64,
    pub kind: String,
    #[serde(default)]
    pub steps: u32,
}

impl Route {
    pub fn valid(&self, bounds: f64) -> bool {
        let dx = self.end[0] - self.start[0];
        let dz = self.end[2] - self.start[2];
        let rise = (self.end[1] - self.start[1]).abs();
        [self.start, self.end].iter().all(|p| {
            p.iter().all(|n| n.is_finite())
                && p[0].abs() <= bounds
                && p[2].abs() <= bounds
                && (0.0..=256.0).contains(&p[1])
        }) && self.width.is_finite()
            && (2.0..=40.0).contains(&self.width)
            && matches!(self.kind.as_str(), "stairs" | "ramp" | "hill" | "street")
            && (dx == 0.0) != (dz == 0.0)
            && rise / dx.hypot(dz) <= 0.5
            && (self.kind != "stairs"
                || (1..=2048).contains(&self.steps) && rise / f64::from(self.steps) <= 0.4)
    }

    fn axis(&self) -> usize {
        if self.start[0] == self.end[0] { 2 } else { 0 }
    }

    pub fn height(&self, x: f64, z: f64) -> Option<f64> {
        let (axis, p) = (self.axis(), [x, 0.0, z]);
        let t = (p[axis] - self.start[axis]) / (self.end[axis] - self.start[axis]);
        if !(0.0..=1.0).contains(&t)
            || (p[2 - axis] - self.start[2 - axis]).abs() > self.width / 2.0
        {
            return None;
        }
        let progress = if self.kind == "stairs" {
            (t * f64::from(self.steps) - 1e-9).ceil() / f64::from(self.steps)
        } else {
            t
        };
        Some(self.start[1] + (self.end[1] - self.start[1]) * progress)
    }

    pub fn bottom(&self, top: f64) -> f64 {
        if self.kind == "hill" { 0.0 } else { top - 0.35 }
    }

    pub fn blocks_ray(&self, a: [f64; 3], b: [f64; 3]) -> bool {
        let axis = self.axis();
        let cross = 2 - axis;
        let count = if self.kind == "stairs" { self.steps } else { 1 };
        for i in 0..count {
            let from = self.start[axis]
                + (self.end[axis] - self.start[axis]) * f64::from(i) / f64::from(count);
            let to = self.start[axis]
                + (self.end[axis] - self.start[axis]) * f64::from(i + 1) / f64::from(count);
            let slope = if self.kind == "stairs" {
                0.0
            } else {
                (self.end[1] - self.start[1]) / (self.end[axis] - self.start[axis])
            };
            let intercept = if self.kind == "stairs" {
                self.start[1] + (self.end[1] - self.start[1]) * f64::from(i + 1) / f64::from(count)
            } else {
                self.start[1] - slope * self.start[axis]
            };
            let planes = [
                (a[axis], b[axis] - a[axis], from.min(to), from.max(to)),
                (
                    a[cross],
                    b[cross] - a[cross],
                    self.start[cross] - self.width / 2.0,
                    self.start[cross] + self.width / 2.0,
                ),
                (
                    a[1] - slope * a[axis],
                    b[1] - a[1] - slope * (b[axis] - a[axis]),
                    if self.kind == "hill" {
                        f64::NEG_INFINITY
                    } else {
                        intercept - 0.35
                    },
                    intercept,
                ),
                (
                    a[1],
                    b[1] - a[1],
                    if self.kind == "hill" {
                        0.0
                    } else {
                        f64::NEG_INFINITY
                    },
                    f64::INFINITY,
                ),
            ];
            let (mut enter, mut leave) = (0.0_f64, 1.0_f64);
            for (origin, delta, low, high) in planes {
                if delta.abs() < 1e-9 {
                    if origin <= low || origin >= high {
                        leave = -1.0;
                        break;
                    }
                } else {
                    let (t0, t1) = ((low - origin) / delta, (high - origin) / delta);
                    enter = enter.max(t0.min(t1));
                    leave = leave.min(t0.max(t1));
                }
            }
            if enter < leave {
                return true;
            }
        }
        false
    }
}
