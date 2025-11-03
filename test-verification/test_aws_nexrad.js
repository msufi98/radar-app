/**
 * Test NEXRAD Level 2 File Reading from AWS S3
 * Mirrors PyART example from: https://arm-doe.github.io/pyart/examples/io/plot_nexrad_data_aws.html
 */

import { read_nexrad_archive } from '../src/nexrad_archive.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Main test function
 */
async function runTest() {
    try {
        console.log('=== NEXRAD AWS S3 Test (JavaScript) ===\n');

        // Test file from PyART example
        const aws_nexrad_level2_file = "s3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06";

        console.log(`Reading file: ${aws_nexrad_level2_file}\n`);

        // Read the NEXRAD archive using our function (mirrors pyart.io.read_nexrad_archive)
        const radar = await read_nexrad_archive(aws_nexrad_level2_file);

        console.log('\n=== File Information ===');

        // Extract comprehensive data for comparison with PyART
        const output = {
            // Basic info
            volume_header: radar.volumeHeader,
            vcp_pattern: radar.getVCPPattern(),
            nscans: radar.nscans,
            location: radar.location(),

            // VCP information
            vcp: {
                pattern_number: radar.vcp?.msg5_header?.pattern_number,
                num_cuts: radar.vcp?.msg5_header?.num_cuts,
                doppler_vel_res: radar.vcp?.msg5_header?.doppler_vel_res,
                pulse_width: radar.vcp?.msg5_header?.pulse_width
            },

            // Radial counts
            total_radials: radar.radialRecords.length,
            message_type: radar.msgType,

            // Scan information
            scan_info: radar.scan_info(),

            // Number of rays per scan
            nrays_per_scan: {},

            // Target angles
            target_angles: radar.get_target_angles(),

            // Times
            times: {
                base_time: radar.get_times().time,
                time_offset_sample: radar.get_times().time_offset.slice(0, 5)
            },

            // Angular data (first 5 values for comparison)
            azimuth_angles_sample: radar.get_azimuth_angles().slice(0, 5),
            elevation_angles_sample: radar.get_elevation_angles().slice(0, 5),

            // Nyquist velocity and unambiguous range (first 5 values)
            nyquist_vel_sample: radar.get_nyquist_vel().slice(0, 5),
            unambiguous_range_sample: radar.get_unambigous_range().slice(0, 5),

            // Moment data
            moments: {}
        };

        // Get number of rays for each scan
        for (let scan = 0; scan < radar.nscans; scan++) {
            output.nrays_per_scan[`scan_${scan}`] = radar.get_nrays(scan);
        }

        // Get moment data for common NEXRAD moments
        const moments_to_check = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO'];

        for (const moment of moments_to_check) {
            try {
                // Try to get range for first scan
                const range_info = radar.get_range(0, moment);
                const max_ngates = range_info.length;

                // Get data for this moment
                const data = radar.get_data(moment, max_ngates);

                // Get metadata from first radial
                const firstRadial = radar.radialRecords[0];
                const momData = firstRadial[moment];

                output.moments[moment] = {
                    available: true,
                    scans_with_data: [],
                    max_ngates: max_ngates,
                    data_shape: [data.length, max_ngates],

                    // Metadata from first occurrence
                    first_gate: momData?.first_gate || 0,
                    gate_spacing: momData?.gate_spacing || 0,
                    scale: momData?.scale || 0,
                    offset: momData?.offset || 0,

                    // Sample data (first ray, first 10 gates)
                    data_sample: data[0] ? data[0].slice(0, 10) : [],

                    // Range sample (first 10 gates)
                    range_sample: range_info.slice(0, 10)
                };

                // Check which scans have this moment
                for (let scan = 0; scan < radar.nscans; scan++) {
                    const scanInfo = output.scan_info[scan];
                    if (scanInfo.moments.includes(moment)) {
                        output.moments[moment].scans_with_data.push(scan);
                    }
                }

                console.log(`Moment ${moment}: Available in scans ${output.moments[moment].scans_with_data.join(', ')}, shape [${data.length}, ${max_ngates}]`);
            } catch (e) {
                output.moments[moment] = {
                    available: false,
                    error: e.message
                };
                console.log(`Moment ${moment}: Not available - ${e.message}`);
            }
        }

        // Print summary
        console.log('\n=== Summary ===');
        console.log(`Site ID: ${output.volume_header.icao.trim()}`);
        console.log(`Location: ${JSON.stringify(output.location)}`);
        console.log(`VCP Pattern: ${output.vcp_pattern}`);
        console.log(`Number of scans: ${output.nscans}`);
        console.log(`Total radials: ${output.total_radials}`);
        console.log(`Available moments: ${Object.keys(output.moments).filter(m => output.moments[m].available).join(', ')}`);

        // Save output to file
        const outputPath = path.join(__dirname, 'output', 'aws_nexrad_output_js.json');
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
        console.log(`\n✓ Output saved to: ${outputPath}`);

        console.log('\nTest complete!');

    } catch (error) {
        console.error('Error during test:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
runTest();
