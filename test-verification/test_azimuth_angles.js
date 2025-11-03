/**
 * Azimuth Angle Verification Test
 * Tests reflectivity values at specific azimuth angles (30°, 60°, 180°, 359°)
 * Compares hi-res and regular resolution data
 */

import { read_nexrad_archive } from '../src/nexrad_archive.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test files - selecting 3 different files from different dates
const TEST_FILES = [
    {
        name: 'KHGX-2022',
        uri: 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06',
        description: 'Houston, TX - March 2022'
    },
    {
        name: 'KBBX-2016',
        uri: 's3://unidata-nexrad-level2/2016/12/10/KBBX/KBBX20161210_003057_V06',
        description: 'Beale AFB, CA - December 2016'
    },
    {
        name: 'KCBW-2000',
        uri: 's3://unidata-nexrad-level2/2000/08/08/KCBW/KCBW20000808_003027.gz',
        description: 'Houlton, ME - August 2000'
    }
];

// Target azimuth angles to test
const TARGET_AZIMUTHS = [30, 60, 180, 359];

/**
 * Find radial index closest to target azimuth
 */
function findRadialAtAzimuth(radar, scanIndex, targetAzimuth) {
    const scan = radar.scans[scanIndex];
    if (!scan) return null;

    let closestIndex = null;
    let closestDiff = Infinity;

    for (let i = 0; i < scan.indices.length; i++) {
        const radialIndex = scan.indices[i];
        const radial = radar.radialRecords[radialIndex];
        const azimuth = radial.msg_header?.azimuth_angle;

        // Handle wrap-around at 360°
        let diff = Math.abs(azimuth - targetAzimuth);
        if (diff > 180) {
            diff = 360 - diff;
        }

        if (diff < closestDiff) {
            closestDiff = diff;
            closestIndex = radialIndex;
        }
    }

    return closestIndex;
}

/**
 * Extract reflectivity values at specific gates
 */
function extractReflectivityValues(data, gates = [0, 10, 50, 100, 200, 500, 1000]) {
    const values = {};
    for (const gate of gates) {
        if (gate < data.length) {
            values[`gate_${gate}`] = data[gate];
        }
    }
    return values;
}

/**
 * Calculate statistics for an array
 */
function calculateStats(data) {
    const validData = data.filter(v => v !== null && v !== undefined && !isNaN(v));

    if (validData.length === 0) {
        return {
            count: 0,
            valid: 0,
            null: data.length,
            min: null,
            max: null,
            mean: null,
            std: null
        };
    }

    const min = Math.min(...validData);
    const max = Math.max(...validData);
    const sum = validData.reduce((a, b) => a + b, 0);
    const mean = sum / validData.length;

    // Calculate standard deviation
    const squaredDiffs = validData.map(v => Math.pow(v - mean, 2));
    const variance = squaredDiffs.reduce((a, b) => a + b, 0) / validData.length;
    const std = Math.sqrt(variance);

    return {
        count: data.length,
        valid: validData.length,
        null: data.length - validData.length,
        min: min,
        max: max,
        mean: mean,
        std: std
    };
}

/**
 * Test a single file
 */
async function testFile(fileInfo) {
    console.log('\n' + '='.repeat(80));
    console.log(`Testing: ${fileInfo.name}`);
    console.log(`Description: ${fileInfo.description}`);
    console.log(`URI: ${fileInfo.uri}`);
    console.log('='.repeat(80));

    try {
        // Read the file
        console.log('\nReading NEXRAD file...');
        const radar = await read_nexrad_archive(fileInfo.uri);

        console.log(`\n✓ File loaded successfully`);
        console.log(`  - Site: ${radar.volumeHeader.icao.trim()}`);
        console.log(`  - VCP: ${radar.getVCPPattern()}`);
        console.log(`  - Total Scans: ${radar.nscans}`);
        console.log(`  - Total Radials: ${radar.radialRecords.length}`);

        const results = {
            file: fileInfo.name,
            uri: fileInfo.uri,
            site: radar.volumeHeader.icao.trim(),
            vcp: radar.getVCPPattern(),
            scans: []
        };

        // Test each scan (first few scans typically have different resolutions)
        const scansToTest = Math.min(3, radar.nscans);

        for (let scanIdx = 0; scanIdx < scansToTest; scanIdx++) {
            const scan = radar.scans[scanIdx];

            if (!scan || !scan.indices || scan.indices.length === 0) {
                console.log(`\n--- Scan ${scanIdx} ---`);
                console.log(`  ⚠ Scan has no radials, skipping`);
                continue;
            }

            // Get elevation from first radial in scan
            const firstRadialIdx = scan.indices[0];
            const firstRadial = radar.radialRecords[firstRadialIdx];
            const elevation = firstRadial?.msg_header?.elevation_angle;

            if (elevation === undefined || elevation === null) {
                console.log(`\n--- Scan ${scanIdx} ---`);
                console.log(`  ⚠ No elevation data available, skipping`);
                continue;
            }

            console.log(`\n--- Scan ${scanIdx} ---`);
            console.log(`  Elevation: ${elevation.toFixed(2)}°`);
            console.log(`  Radials: ${scan.indices.length}`);

            // Get range information for REF
            const rangeInfo = radar.get_range(scanIdx, 'REF');
            const maxGates = rangeInfo.length;
            console.log(`  Max Gates (REF): ${maxGates}`);
            console.log(`  Range: ${rangeInfo.first_gate}m to ${rangeInfo.first_gate + (maxGates * rangeInfo.gate_spacing)}m`);
            console.log(`  Gate Spacing: ${rangeInfo.gate_spacing}m`);

            // Determine if this is hi-res or regular
            const isHiRes = rangeInfo.gate_spacing <= 250;
            console.log(`  Resolution: ${isHiRes ? 'HI-RES' : 'REGULAR'}`);

            const scanResult = {
                scan_index: scanIdx,
                elevation: elevation,
                radials: scan.indices.length,
                resolution: isHiRes ? 'hi-res' : 'regular',
                gate_spacing: rangeInfo.gate_spacing,
                max_gates: maxGates,
                azimuths: []
            };

            // Test each target azimuth
            for (const targetAz of TARGET_AZIMUTHS) {
                const radialIdx = findRadialAtAzimuth(radar, scanIdx, targetAz);

                if (radialIdx === null) {
                    console.log(`  ⚠ No radial found near ${targetAz}°`);
                    continue;
                }

                const radial = radar.radialRecords[radialIdx];
                const actualAz = radial.msg_header.azimuth_angle;
                const azDiff = Math.abs(actualAz - targetAz);

                console.log(`\n  Azimuth ${targetAz}°:`);
                console.log(`    Actual azimuth: ${actualAz.toFixed(2)}° (diff: ${azDiff.toFixed(2)}°)`);
                console.log(`    Radial index: ${radialIdx}`);

                // Get REF data for this radial
                const refData = radar.get_data('REF', maxGates);
                const radialData = refData[radialIdx];

                if (!radialData) {
                    console.log(`    ⚠ No REF data for this radial`);
                    continue;
                }

                // Extract sample values
                const sampleValues = extractReflectivityValues(radialData);
                const stats = calculateStats(radialData);

                console.log(`    Valid/Total: ${stats.valid}/${stats.count}`);
                console.log(`    Range: ${stats.min?.toFixed(2)} to ${stats.max?.toFixed(2)} dBZ`);
                console.log(`    Mean: ${stats.mean?.toFixed(2)} dBZ`);
                console.log(`    Std Dev: ${stats.std?.toFixed(2)} dBZ`);
                console.log(`    Sample values:`);
                for (const [gate, value] of Object.entries(sampleValues)) {
                    const valStr = value === null ? 'null' : `${value.toFixed(2)} dBZ`;
                    console.log(`      ${gate}: ${valStr}`);
                }

                scanResult.azimuths.push({
                    target_azimuth: targetAz,
                    actual_azimuth: actualAz,
                    azimuth_diff: azDiff,
                    radial_index: radialIdx,
                    statistics: stats,
                    sample_values: sampleValues,
                    // Store full radial data for detailed comparison
                    full_data: radialData
                });
            }

            results.scans.push(scanResult);
        }

        return results;

    } catch (error) {
        console.error(`\n✗ Error testing file: ${error.message}`);
        console.error(error.stack);
        return {
            file: fileInfo.name,
            uri: fileInfo.uri,
            error: error.message
        };
    }
}

/**
 * Main test function
 */
async function runTests() {
    console.log('='.repeat(80));
    console.log('NEXRAD Azimuth Angle Verification Test');
    console.log('='.repeat(80));
    console.log(`\nTesting ${TEST_FILES.length} files`);
    console.log(`Target azimuths: ${TARGET_AZIMUTHS.join('°, ')}°`);
    console.log(`Testing both hi-res and regular resolution data`);

    const allResults = {
        test_date: new Date().toISOString(),
        test_description: 'Reflectivity values at specific azimuth angles',
        target_azimuths: TARGET_AZIMUTHS,
        files: []
    };

    // Test each file
    for (const fileInfo of TEST_FILES) {
        const result = await testFile(fileInfo);
        allResults.files.push(result);
    }

    // Save results
    const outputDir = path.join(__dirname, 'output');
    await fs.mkdir(outputDir, { recursive: true });

    const outputPath = path.join(outputDir, 'azimuth_test_js.json');
    await fs.writeFile(outputPath, JSON.stringify(allResults, null, 2));

    console.log('\n' + '='.repeat(80));
    console.log('Test Complete');
    console.log('='.repeat(80));
    console.log(`✓ Results saved to: ${outputPath}`);
    console.log('\nNext steps:');
    console.log('1. Run: python test_azimuth_angles.py');
    console.log('2. Compare azimuth_test_js.json with azimuth_test_py.json');
    console.log('3. Verify reflectivity values match at all tested angles');
}

// Run tests
runTests().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
