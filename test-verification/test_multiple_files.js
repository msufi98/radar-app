/**
 * Test Multiple NEXRAD Level 2 Files from AWS S3
 * Verifies the implementation with different sites, dates, and file formats
 */

import { read_nexrad_archive } from '../src/nexrad_archive.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Test files from different sites, dates, and formats
const TEST_FILES = [
    {
        name: 'KCBW_2000',
        uri: 's3://unidata-nexrad-level2/2000/08/08/KCBW/KCBW20000808_003027.gz',
        site: 'KCBW',
        date: '2000/08/08',
        description: 'Year 2000, .gz compressed'
    },
    {
        name: 'KBBX_2016',
        uri: 's3://unidata-nexrad-level2/2016/12/10/KBBX/KBBX20161210_003057_V06',
        site: 'KBBX',
        date: '2016/12/10',
        description: 'Year 2016, V06 format'
    },
    {
        name: 'KHGX_2022',
        uri: 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06',
        site: 'KHGX',
        date: '2022/03/22',
        description: 'Year 2022, V06 format (reference)'
    }
];

/**
 * Test a single file
 */
async function testFile(testFile) {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`Testing: ${testFile.name}`);
    console.log(`File: ${testFile.uri}`);
    console.log(`Description: ${testFile.description}`);
    console.log('='.repeat(80));

    try {
        const startTime = Date.now();

        // Read the NEXRAD archive
        const radar = await read_nexrad_archive(testFile.uri);

        const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);

        // Collect results
        const result = {
            test_name: testFile.name,
            test_uri: testFile.uri,
            test_site: testFile.site,
            test_date: testFile.date,

            // File info
            volume_header: radar.volumeHeader,
            vcp_pattern: radar.getVCPPattern(),
            nscans: radar.nscans,
            location: radar.location(),
            total_radials: radar.radialRecords.length,
            message_type: radar.msgType,

            // Performance
            parse_time_seconds: elapsedTime,

            // Scan info
            scan_info: radar.scan_info(),
            nrays_per_scan: {},

            // Available moments
            moments_summary: {},

            // Sample data from first scan
            sample_data: {}
        };

        // Get rays per scan
        for (let scan = 0; scan < radar.nscans; scan++) {
            result.nrays_per_scan[`scan_${scan}`] = radar.get_nrays(scan);
        }

        // Check all common moments
        const moments_to_check = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'];

        for (const moment of moments_to_check) {
            try {
                const range_info = radar.get_range(0, moment);
                const max_ngates = range_info.length;
                const data = radar.get_data(moment, max_ngates);

                // Get scans with this moment
                const scans_with_moment = [];
                for (let scan = 0; scan < radar.nscans; scan++) {
                    const scanInfo = result.scan_info[scan];
                    if (scanInfo.moments.includes(moment)) {
                        scans_with_moment.push(scan);
                    }
                }

                result.moments_summary[moment] = {
                    available: true,
                    scans_with_data: scans_with_moment,
                    num_scans: scans_with_moment.length,
                    data_shape: [data.length, max_ngates],
                    first_gate: range_info[0],
                    gate_spacing: range_info[1] - range_info[0]
                };

                // Sample data (first 5 valid values)
                const validSamples = [];
                for (let i = 0; i < data[0]?.length && validSamples.length < 5; i++) {
                    if (data[0][i] !== null && data[0][i] !== undefined) {
                        validSamples.push(data[0][i]);
                    }
                }
                result.sample_data[moment] = validSamples;

                console.log(`  ✓ ${moment}: ${scans_with_moment.length} scans, shape [${data.length}, ${max_ngates}]`);
            } catch (e) {
                result.moments_summary[moment] = {
                    available: false,
                    error: e.message
                };
                console.log(`  ✗ ${moment}: Not available`);
            }
        }

        // Print summary
        console.log(`\n📊 Summary:`);
        console.log(`  Site: ${result.volume_header.icao.trim()}`);
        console.log(`  Location: ${JSON.stringify(result.location)}`);
        console.log(`  VCP: ${result.vcp_pattern}`);
        console.log(`  Scans: ${result.nscans}`);
        console.log(`  Total Radials: ${result.total_radials}`);
        console.log(`  Message Type: ${result.message_type}`);
        console.log(`  Parse Time: ${result.parse_time_seconds}s`);

        const availableMoments = Object.keys(result.moments_summary)
            .filter(m => result.moments_summary[m].available);
        console.log(`  Available Moments: ${availableMoments.join(', ')}`);

        return { success: true, result };

    } catch (error) {
        console.error(`\n❌ Error testing ${testFile.name}:`, error.message);
        console.error(error.stack);

        return {
            success: false,
            test_name: testFile.name,
            test_uri: testFile.uri,
            error: error.message,
            stack: error.stack
        };
    }
}

/**
 * Main test function
 */
async function runTests() {
    console.log('='.repeat(80));
    console.log('NEXRAD Level 2 File - Multi-File Verification Test (JavaScript)');
    console.log('='.repeat(80));

    const results = [];

    for (const fileConfig of TEST_FILES) {
        const result = await testFile(fileConfig);
        results.push(result);

        // Small delay between tests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Save all results
    const outputPath = path.join(__dirname, 'output', 'multi_file_test_results_js.json');
    await fs.writeFile(outputPath, JSON.stringify(results, null, 2));

    // Print final summary
    console.log(`\n${'='.repeat(80)}`);
    console.log('FINAL SUMMARY');
    console.log('='.repeat(80));

    let successCount = 0;
    let failCount = 0;

    for (const result of results) {
        const status = result.success ? '✓ PASS' : '✗ FAIL';
        const name = result.test_name || result.result?.test_name || 'Unknown';

        if (result.success) {
            successCount++;
            const nscans = result.result.nscans;
            const moments = Object.keys(result.result.moments_summary)
                .filter(m => result.result.moments_summary[m].available).length;
            console.log(`${status} - ${name}: ${nscans} scans, ${moments} moments`);
        } else {
            failCount++;
            console.log(`${status} - ${name}: ${result.error}`);
        }
    }

    console.log(`\nTests Passed: ${successCount}/${results.length}`);
    console.log(`Tests Failed: ${failCount}/${results.length}`);
    console.log(`\n✓ Results saved to: ${outputPath}`);

    process.exit(failCount > 0 ? 1 : 0);
}

// Run the tests
runTests();
