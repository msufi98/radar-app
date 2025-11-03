# Azimuth Angle Verification Tests

## Overview
This test suite verifies that the JavaScript NEXRAD implementation produces identical reflectivity values to PyART at specific azimuth angles, for both hi-resolution and regular resolution data.

## Test Methodology

### Test Files
Three NEXRAD files spanning different time periods and locations:
1. **KHGX-2022**: Houston, TX - March 22, 2022
2. **KBBX-2016**: Beale AFB, CA - December 10, 2016
3. **KCBW-2000**: Houlton, ME - August 8, 2000 (gzip compressed, legacy format)

### Target Azimuth Angles
- 30° (Northeast)
- 60° (East-Northeast)
- 180° (South)
- 359° (Nearly North)

### Resolution Types
- **Hi-Res**: Gate spacing ≤ 250m
- **Regular**: Gate spacing > 250m

## Test Execution

### 1. Run JavaScript Test
```bash
cd test-verification
node test_azimuth_angles.js
```

Outputs: `output/azimuth_test_js.json`

###  2. Run Python/PyART Test
```bash
cd test-verification
python test_azimuth_angles.py
```

Outputs: `output/azimuth_test_py.json`

### 3. Compare Results
```bash
node compare_azimuth_results.js
```

Or manually compare the JSON files.

## What's Being Tested

For each test file and azimuth angle, the tests extract:

1. **Radial Identification**
   - Finds the radial closest to target azimuth
   - Reports actual azimuth and angular difference

2. **Reflectivity Statistics**
   - Valid value count vs total gates
   - Min, Max, Mean values
   - Standard deviation

3. **Sample Gate Values**
   - Gate 0 (closest to radar)
   - Gate 10
   - Gate 50
   - Gate 100
   - Gate 200
   - Gate 500
   - Gate 1000

4. **Full Radial Data**
   - Complete reflectivity array for detailed comparison

5. **Resolution Information**
   - Gate spacing (meters)
   - Max gates
   - Classification (hi-res vs regular)

## Expected Results

JavaScript implementation should match PyART implementation:
- ✓ Exact match for reflectivity values at all gates
- ✓ Identical statistics (min, max, mean within floating point precision)
- ✓ Same classification of hi-res vs regular resolution
- ✓ Radials at same azimuth angles (within 0.1° tolerance)

## Files

- `test_azimuth_angles.js` - JavaScript test using our NEXRAD implementation
- `test_azimuth_angles.py` - Python test using PyART
- `compare_azimuth_results.js` - Comparison script (to be created)
- `output/azimuth_test_js.json` - JavaScript results
- `output/azimuth_test_py.json` - Python/PyART results

## Notes

- Tests use S3 URIs and download via CORS proxy (may be slow)
- For faster testing in Node.js environment, files can be cached locally
- The test validates the entire data pipeline:
  - S3 download
  - Gzip decompression (for KCBW-2000)
  - BZ2 decompression
  - NEXRAD Level 2 parsing
  - Data scaling and calibration
  - Scan/sweep organization

## Previous Verification

See `VERIFICATION_SUMMARY.md` for previous comprehensive validation:
- ✓ Gate-by-gate comparison (100% match)
- ✓ Multi-file structural tests
- ✓ Deep data value comparison

This azimuth angle test adds specific verification at cardinal/intercardinal directions across both resolution types.
