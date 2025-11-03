# NEXRAD Level 2 Parser Verification

This directory contains test scripts to verify the JavaScript implementation of the NEXRAD Level 2 parser against the Python PyART implementation.

## Directory Structure

```
test-verification/
├── data/              # Downloaded NEXRAD files
├── output/            # Test output files
├── test_pyart.ipynb   # Python/PyART test notebook
├── test_nodejs.js     # Node.js test script
├── package.json       # Node.js dependencies
└── README.md          # This file
```

## Test File

Both tests use the same NEXRAD Level 2 file:
- **Site:** KABR (Aberdeen, SD)
- **Date:** 2013-05-06
- **Time:** ~00:02:29 UTC
- **S3 Path:** `s3://unidata-nexrad-level2/2013/05/06/KABR/KABR20130506_000229_V06`

## Running the Tests

### 1. Python/PyART Test (Jupyter Notebook)

```bash
# Install Jupyter if not already installed
pip install jupyter

# Navigate to test-verification directory
cd test-verification

# Start Jupyter
jupyter notebook test_pyart.ipynb
```

Run all cells in the notebook. This will:
1. Download the sample NEXRAD file
2. Parse it using PyART
3. Extract key information
4. Save output to `output/pyart_output.json`

### 2. Node.js Test

```bash
# Navigate to test-verification directory
cd test-verification

# Install dependencies
npm install

# Run the test
npm test
```

This will:
1. Use the same file downloaded by Python (or download if not available)
2. Parse it using the JavaScript implementation
3. Extract the same information
4. Save output to `output/nodejs_output.json`

## Comparing Results

After running both tests, compare the output files:

```bash
# Visual comparison (if you have a diff tool)
diff output/pyart_output.json output/nodejs_output.json

# Or use a JSON diff tool
npx json-diff output/pyart_output.json output/nodejs_output.json
```

## Output Format

Both outputs contain:
- **volume_header**: Tape name, extension, date, time, ICAO code
- **total_records**: Total number of records in file
- **radial_records**: Number of radial (data) records
- **message_type**: Primary message type (1 or 31)
- **vcp_pattern**: Volume Coverage Pattern number
- **location**: Radar latitude, longitude, height
- **first_record_header**: Header of first record
- **first_radial_header**: Header of first radial record
- **moment_info**: Information about data moments (REF, VEL, SW, etc.)

## Expected Differences

Minor differences are acceptable:
- Floating-point precision (e.g., 45.4560012817 vs 45.456)
- String encoding/trimming differences
- Array representation formats

Major differences to investigate:
- Different number of records
- Missing moments
- Incorrect data values
- Parsing errors
