class_name Astronomy
## Positional astronomy for the Aldous Range (56° N, northern British Columbia), late October.
##
## Low-precision (≈0.1°) solar and lunar ephemeris, good enough for a believable sky:
## real sun path (declination from the ecliptic longitude), moon with a proper synodic phase cycle and
## ecliptic latitude, and a sidereal rotation so stars and the Milky Way turn about Polaris.
##
## Frames: Godot world (x = east, y = up, z = south; north = -Z). Equatorial Cartesian:
## X → RA 0h (vernal equinox), Y → RA 6h, Z → north celestial pole.
##
## The clock is local standard time, calibrated so the in-game day 1 (29 Oct) has solar noon at 12:35,
## sunrise ≈ 07:50 and sunset ≈ 17:20 (day length 9 h 30 min, matching 56° N at that date).
## NOTE: at 56° N a 9.5 h day implies a noon sun of ≈21° (27° would need early October); we keep the
## physically consistent value.

const LATITUDE_DEG := 56.0
const OBLIQUITY_DEG := 23.44
## Day-of-year of in-game day 1 (29 October).
const START_DAY_OF_YEAR := 302
## Clock hour at which the sun transits the meridian (local standard time + longitude offset).
const SOLAR_NOON_CLOCK := 12.5833
## Standard altitude for sunrise/sunset: refraction (34') + solar semi-diameter (16').
const HORIZON_ALT_DEG := -0.833
const SYNODIC_MONTH := 29.530588
## Moon phase (0 = new, 0.5 = full) at day 1, 00:00. 0.30 → waxing gibbous on the first evening,
## full moon around day 7, new moon around day 22.
const MOON_PHASE_AT_START := 0.30
## Ascending node of the lunar orbit (deg) – sets the ±5.1° ecliptic latitude wobble.
const MOON_NODE_DEG := 40.0
const MOON_INCLINATION_DEG := 5.145
## Angular radii (deg).
const SUN_ANGULAR_RADIUS_DEG := 0.2666
const MOON_ANGULAR_RADIUS_DEG := 0.2590


## Fractional day of year for an in-game (day, clock hours).
static func day_of_year(day: int, hours: float) -> float:
	return float(START_DAY_OF_YEAR + day - 1) + hours / 24.0


## Sun ecliptic longitude (radians) from the low-precision Astronomical Almanac formula.
static func sun_ecliptic_longitude(doy: float) -> float:
	var n := doy - 1.5          # days from J2000-ish epoch (calendar drift over years is negligible)
	var g := deg_to_rad(fposmod(357.528 + 0.9856003 * n, 360.0))
	var l := 280.460 + 0.9856474 * n
	return deg_to_rad(fposmod(l + 1.915 * sin(g) + 0.020 * sin(2.0 * g), 360.0))


## Equation of time (hours, apparent − mean solar time). Used to keep the noon clock drifting realistically.
static func equation_of_time_h(doy: float) -> float:
	var b := TAU * (doy - 81.0) / 364.0
	return (9.87 * sin(2.0 * b) - 7.53 * cos(b) - 1.5 * sin(b)) / 60.0


## Ecliptic (lon, lat) radians → equatorial unit vector.
static func ecliptic_to_equatorial(lon: float, lat: float) -> Vector3:
	var e := deg_to_rad(OBLIQUITY_DEG)
	var cl := cos(lat)
	var x := cl * cos(lon)
	var y := cl * sin(lon) * cos(e) - sin(lat) * sin(e)
	var z := cl * sin(lon) * sin(e) + sin(lat) * cos(e)
	return Vector3(x, y, z)


## Equatorial unit vector → (RA, Dec) radians.
static func equatorial_to_radec(v: Vector3) -> Vector2:
	return Vector2(fposmod(atan2(v.y, v.x), TAU), asin(clampf(v.z, -1.0, 1.0)))


## Local sidereal time (radians) at the given in-game time. LST = RA_sun + hour angle of the sun.
static func local_sidereal_time(day: int, hours: float) -> float:
	var doy := day_of_year(day, hours)
	var sun_eq := ecliptic_to_equatorial(sun_ecliptic_longitude(doy), 0.0)
	var ra_sun := equatorial_to_radec(sun_eq).x
	var noon := SOLAR_NOON_CLOCK - (equation_of_time_h(doy) - equation_of_time_h(float(START_DAY_OF_YEAR)))
	var hour_angle := deg_to_rad((hours - noon) * 15.0)
	return fposmod(ra_sun + hour_angle, TAU)


## Basis mapping an equatorial vector to a Godot world direction at the given sidereal time.
static func equatorial_to_world_basis(lst: float) -> Basis:
	var phi := deg_to_rad(LATITUDE_DEG)
	# columns = images of equatorial X, Y, Z axes.
	# For a star at (RA a, Dec d): hour angle H = LST - a.
	#   east  = -cos d sin H,  north = cos(phi) sin d - sin(phi) cos d cos H,  up = sin(phi) sin d + cos(phi) cos d cos H
	# With cos d cos H = x cos LST + y sin LST, cos d sin H = x sin LST - y cos LST  (x = cos d cos a, y = cos d sin a).
	var cs := cos(lst)
	var sn := sin(lst)
	var sp := sin(phi)
	var cp := cos(phi)
	# east  = -(x sn - y cs)            = x(-sn) + y(cs)
	# north = cp z - sp (x cs + y sn)
	# up    = sp z + cp (x cs + y sn)
	# world = (east, up, -north)
	var col_x := Vector3(-sn, cp * cs, sp * cs)
	var col_y := Vector3(cs, cp * sn, sp * sn)
	var col_z := Vector3(0.0, sp, -cp)
	return Basis(col_x, col_y, col_z)


static func equatorial_to_world(v_eq: Vector3, lst: float) -> Vector3:
	return equatorial_to_world_basis(lst) * v_eq


## Unit vector from the observer toward the sun (y < 0 at night).
static func sun_direction(day: int, hours: float) -> Vector3:
	var doy := day_of_year(day, hours)
	var eq := ecliptic_to_equatorial(sun_ecliptic_longitude(doy), 0.0)
	return equatorial_to_world(eq, local_sidereal_time(day, hours)).normalized()


## Moon phase 0..1 (0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter).
static func moon_phase(day: int, hours: float) -> float:
	var t := float(day - 1) + hours / 24.0
	return fposmod(MOON_PHASE_AT_START + t / SYNODIC_MONTH, 1.0)


## Illuminated fraction of the lunar disk.
static func moon_illumination(phase: float) -> float:
	return 0.5 * (1.0 - cos(phase * TAU))


## Relative lunar brightness vs. full moon (Allen: m = -12.73 + 0.026|ψ| + 4e-9 ψ⁴, ψ = phase angle).
static func moon_brightness(phase: float) -> float:
	var psi := absf(180.0 - fposmod(phase * 360.0, 360.0))   # 0 at full, 180 at new
	var dm := 0.026 * psi + 4.0e-9 * pow(psi, 4.0)
	return pow(10.0, -0.4 * dm)


## Moon equatorial unit vector.
static func moon_equatorial(day: int, hours: float) -> Vector3:
	var doy := day_of_year(day, hours)
	var lam_s := sun_ecliptic_longitude(doy)
	var elong := moon_phase(day, hours) * TAU
	var lam_m := lam_s + elong
	var beta := deg_to_rad(MOON_INCLINATION_DEG) * sin(lam_m - deg_to_rad(MOON_NODE_DEG))
	return ecliptic_to_equatorial(lam_m, beta)


static func moon_direction(day: int, hours: float) -> Vector3:
	return equatorial_to_world(moon_equatorial(day, hours), local_sidereal_time(day, hours)).normalized()


## Elevation (deg) of a world direction.
static func elevation_deg(dir: Vector3) -> float:
	return rad_to_deg(asin(clampf(dir.y, -1.0, 1.0)))


## Compass azimuth (deg, 0 = north, 90 = east) of a world direction.
static func azimuth_deg(dir: Vector3) -> float:
	return fposmod(rad_to_deg(atan2(dir.x, -dir.z)), 360.0)


## Clock time (hours) at which the sun crosses the given altitude, morning (rising=true) or evening.
## Returns -1 if it never does that day (not the case at 56° N in autumn).
static func sun_crossing_hour(day: int, altitude_deg: float, rising: bool) -> float:
	# Coarse scan then bisection on the real ephemeris.
	var lo := 0.0 if rising else SOLAR_NOON_CLOCK
	var hi := SOLAR_NOON_CLOCK if rising else 24.0
	var f_lo := elevation_deg(sun_direction(day, lo)) - altitude_deg
	var f_hi := elevation_deg(sun_direction(day, hi)) - altitude_deg
	if signf(f_lo) == signf(f_hi):
		return -1.0
	for _i in 40:
		var mid := 0.5 * (lo + hi)
		var f_mid := elevation_deg(sun_direction(day, mid)) - altitude_deg
		if signf(f_mid) == signf(f_lo):
			lo = mid
			f_lo = f_mid
		else:
			hi = mid
	return 0.5 * (lo + hi)


static func sunrise_hour(day: int) -> float:
	return sun_crossing_hour(day, HORIZON_ALT_DEG, true)


static func sunset_hour(day: int) -> float:
	return sun_crossing_hour(day, HORIZON_ALT_DEG, false)
