use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tracing::{debug, info, warn};

const MAX_SYNC_ROUND_TRIP: Duration = Duration::from_millis(1500);
const MIN_CLOCK_STEP_MS: i64 = 250;
const LEGACY_DATETIME_CLOCK_STEP_MS: i64 = 1_500;
const APP_READY_CLOCK_STEP_MS: i64 = 60_000;
const HALF_SECOND_MS: i64 = 500;

pub fn phone_time_at_receipt_ms(phone_unix_ms: i64, round_trip: Duration) -> Option<i64> {
    if round_trip > MAX_SYNC_ROUND_TRIP {
        return None;
    }
    let half_round_trip_ms = i64::try_from(round_trip.as_millis() / 2).ok()?;
    phone_unix_ms.checked_add(half_round_trip_ms)
}

pub fn clock_step_ms(target_unix_ms: i64, local_unix_ms: i64, min_step_ms: i64) -> Option<i64> {
    let delta = target_unix_ms.checked_sub(local_unix_ms)?;
    (delta.abs() >= min_step_ms).then_some(delta)
}

pub fn parse_utc_datetime_ms(datetime: &str) -> Option<i64> {
    let datetime = datetime.trim().trim_end_matches('Z');
    let (date, time) = datetime.split_once([' ', 'T'])?;
    let mut date_parts = date.splitn(3, '-').map(str::parse::<i64>);
    let (year, month, day) = (
        date_parts.next()?.ok()?,
        date_parts.next()?.ok()?,
        date_parts.next()?.ok()?,
    );
    let mut time_parts = time.splitn(3, ':').map(str::parse::<i64>);
    let (hour, minute, second) = (
        time_parts.next()?.ok()?,
        time_parts.next()?.ok()?,
        time_parts.next()?.ok()?,
    );
    if !(1..=12).contains(&month)
        || !(1..=31).contains(&day)
        || !(0..24).contains(&hour)
        || !(0..60).contains(&minute)
        || !(0..=60).contains(&second)
    {
        return None;
    }

    let shifted_year = if month <= 2 { year - 1 } else { year };
    let era = shifted_year.div_euclid(400);
    let year_of_era = shifted_year - era * 400;
    let shifted_month = (month + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + day - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    let days_since_epoch = era * 146_097 + day_of_era - 719_468;
    Some(((days_since_epoch * 24 + hour) * 60 + minute) * 60_000 + second * 1000)
}

pub fn sync_from_phone_time_response(phone_unix_ms: u64, round_trip: Duration) {
    let Ok(phone_unix_ms) = i64::try_from(phone_unix_ms) else {
        return;
    };
    sync_from_round_trip(phone_unix_ms, round_trip, MIN_CLOCK_STEP_MS);
}

pub fn sync_from_phone_datetime_response(datetime: &str, round_trip: Duration) {
    let Some(phone_unix_ms) = parse_utc_datetime_ms(datetime) else {
        warn!(datetime, "Ignoring unparseable phone datetime");
        return;
    };
    sync_from_round_trip(
        phone_unix_ms + HALF_SECOND_MS,
        round_trip,
        LEGACY_DATETIME_CLOCK_STEP_MS,
    );
}

pub fn sync_from_app_ready(phone_unix_ms: u64) {
    let Ok(target_unix_ms) = i64::try_from(phone_unix_ms) else {
        return;
    };
    step_system_clock(target_unix_ms, APP_READY_CLOCK_STEP_MS, "app.ready", 0);
}

pub fn sync_from_app_ready_datetime(datetime: &str) {
    let Some(phone_unix_ms) = parse_utc_datetime_ms(datetime) else {
        warn!(datetime, "Ignoring unparseable app.ready datetime");
        return;
    };
    step_system_clock(
        phone_unix_ms + HALF_SECOND_MS,
        APP_READY_CLOCK_STEP_MS,
        "app.ready",
        0,
    );
}

fn sync_from_round_trip(phone_unix_ms: i64, round_trip: Duration, min_step_ms: i64) {
    let round_trip_ms = round_trip.as_millis();
    let Some(target_unix_ms) = phone_time_at_receipt_ms(phone_unix_ms, round_trip) else {
        info!(
            round_trip_ms,
            "Ignoring phone time sample with slow round trip"
        );
        return;
    };
    step_system_clock(
        target_unix_ms,
        min_step_ms,
        "device.time.get",
        round_trip_ms,
    );
}

fn step_system_clock(target_unix_ms: i64, min_step_ms: i64, source: &str, round_trip_ms: u128) {
    let local_unix_ms = system_unix_ms();
    let Some(delta_ms) = clock_step_ms(target_unix_ms, local_unix_ms, min_step_ms) else {
        debug!(
            source,
            round_trip_ms,
            offset_ms = target_unix_ms - local_unix_ms,
            "System clock within tolerance of phone time"
        );
        return;
    };

    match set_system_unix_ms(local_unix_ms + delta_ms) {
        Ok(()) => info!(
            source,
            round_trip_ms, delta_ms, "Stepped system clock to phone time"
        ),
        Err(err) => warn!(source, delta_ms, %err, "Failed to step system clock"),
    }
}

fn system_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|elapsed| i64::try_from(elapsed.as_millis()).ok())
        .unwrap_or(0)
}

fn set_system_unix_ms(unix_ms: i64) -> std::io::Result<()> {
    let time = libc::timespec {
        tv_sec: unix_ms.div_euclid(1000) as libc::time_t,
        tv_nsec: (unix_ms.rem_euclid(1000) * 1_000_000) as libc::c_long,
    };
    // SAFETY: `time` is a valid, fully initialized timespec that outlives the call.
    if unsafe { libc::clock_settime(libc::CLOCK_REALTIME, &time) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compensates_half_the_round_trip() {
        assert_eq!(
            phone_time_at_receipt_ms(1_000_000, Duration::from_millis(240)),
            Some(1_000_120)
        );
    }

    #[test]
    fn rejects_samples_delayed_in_transit() {
        assert_eq!(
            phone_time_at_receipt_ms(1_000_000, Duration::from_millis(1501)),
            None
        );
    }

    #[test]
    fn parses_phone_utc_datetimes() {
        assert_eq!(parse_utc_datetime_ms("1970-01-01 00:00:00"), Some(0));
        assert_eq!(
            parse_utc_datetime_ms("2026-10-04 00:36:55"),
            Some(1_791_074_215_000)
        );
        assert_eq!(
            parse_utc_datetime_ms("2024-02-29T12:00:00Z"),
            Some(1_709_208_000_000)
        );
        assert_eq!(parse_utc_datetime_ms("2026-13-01 00:00:00"), None);
        assert_eq!(parse_utc_datetime_ms("not a date"), None);
    }

    #[test]
    fn steps_only_beyond_tolerance() {
        assert_eq!(clock_step_ms(10_000, 9_900, MIN_CLOCK_STEP_MS), None);
        assert_eq!(
            clock_step_ms(17_240, 10_000, MIN_CLOCK_STEP_MS),
            Some(7_240)
        );
        assert_eq!(clock_step_ms(10_000, 10_300, MIN_CLOCK_STEP_MS), Some(-300));
    }

    #[test]
    fn app_ready_only_corrects_gross_errors() {
        assert_eq!(
            clock_step_ms(1_000_000, 993_000, APP_READY_CLOCK_STEP_MS),
            None
        );
        assert_eq!(
            clock_step_ms(1_791_000_000_000, 0, APP_READY_CLOCK_STEP_MS),
            Some(1_791_000_000_000)
        );
    }
}
