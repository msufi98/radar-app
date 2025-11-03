/**
 * NEXRAD Level 2 File Class Verification - Node.js
 * Tests NEXRADLevel2File class methods to match Python implementation
 */

import { NEXRADLevel2File } from '../src/nexrad-level2.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import zlib from 'zlib';
import { promisify } from 'util';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const gunzip = promisify(zlib.gunzip);

/**
 * Prepare file for reading - handles decompression (like PyART's prepare_for_read)
 */
async function prepareForRead(filepath) {
    console.log(`Reading file: ${filepath}`);

    // Read the file
    let buffer = await fs.readFile(filepath);

    // Check for gzip compression (magic bytes: 0x1f 0x8b)
    if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        console.log('File is gzip compressed, decompressing...');
        buffer = await gunzip(buffer);
        console.log(`Decompressed size: ${buffer.length} bytes`);
    }
    // Check for bzip2 compression (magic bytes: "BZ")
    else if (buffer[0] === 0x42 && buffer[1] === 0x5a) {
        throw new Error('BZ2 compression detected - this should be handled by NEXRADLevel2File internally');
    }

    return buffer;
}

/**
 * Main test function
 */
async function runTest() {
    try {
        console.log('=== NEXRAD Level 2 File Class Test (Node.js) ===\n');

        // Read test file info from Python
        const fileInfo = JSON.parse(
            await fs.readFile(path.join(__dirname, 'data', 'test_file_info.json'), 'utf8')
        );

        const localFile = path.join(__dirname, fileInfo.local_path);
        console.log(`Using file: ${localFile}\n`);

        // Prepare file for reading (decompress if needed)
        const buffer = await prepareForRead(localFile);

        // Parse with NEXRADLevel2File
        console.log('Parsing with NEXRADLevel2File...\n');
        const nexradFile = new NEXRADLevel2File(buffer.buffer);

        console.log('File parsed successfully!\n');

        // Extract data using class methods (matching Python NEXRADLevel2File API)
        const output = {
            volume_header: nexradFile.volumeHeader,
            vcp: nexradFile.vcp,
            nscans: nexradFile.nscans,
            location: nexradFile.location(),
            vcp_pattern: nexradFile.getVCPPattern(),

            // Radial records info
            total_radial_records: nexradFile.radialRecords.length,
            message_type: nexradFile.msgType,

            // Scan information
            scan_info: nexradFile.scan_info(),

            // Times
            times: nexradFile.get_times(),

            // Angular data
            azimuth_angles: nexradFile.get_azimuth_angles().slice(0, 10), // First 10 for comparison
            elevation_angles: nexradFile.get_elevation_angles().slice(0, 10), // First 10 for comparison
            target_angles: nexradFile.get_target_angles(),

            // Other data
            nyquist_vel: nexradFile.get_nyquist_vel().slice(0, 10), // First 10 for comparison
            unambiguous_range: nexradFile.get_unambigous_range().slice(0, 10), // First 10 for comparison

            // Number of rays per scan
            nrays_per_scan: {},

            // Moment data
            moments: {}
        };

        // Get number of rays for each scan
        for (let scan = 0; scan < nexradFile.nscans; scan++) {
            output.nrays_per_scan[`scan_${scan}`] = nexradFile.get_nrays(scan);
        }

        // Get moment data using new methods
        const moments_to_check = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO'];

        for (const moment of moments_to_check) {
            try {
                // Get range information for first scan
                const range_info = nexradFile.get_range(0, moment);
                const max_ngates = range_info.length;

                // Get data for this moment (using max_ngates from range info)
                const data = nexradFile.get_data(moment, max_ngates);

                // Get first radial for additional info
                const firstRadial = nexradFile.radialRecords[0];
                const momData = firstRadial[moment];

                output.moments[moment] = {
                    available: true,
                    range_info: range_info.slice(0, 10), // First 10 for comparison
                    max_ngates: max_ngates,
                    ngates: momData.ngates || 0,
                    first_gate: momData.first_gate || 0,
                    gate_spacing: momData.gate_spacing || 0,
                    scale: momData.scale || 0,
                    offset: momData.offset || 0,
                    data_shape: [data.length, max_ngates],
                    data_sample: data[0] ? data[0].slice(0, 10) : []
                };
                console.log(`Moment ${moment}: Available, shape [${data.length}, ${max_ngates}]`);
            } catch (e) {
                output.moments[moment] = {
                    available: false,
                    error: e.message
                };
                console.log(`Moment ${moment}: Not available - ${e.message}`);
            }
        }

        // Print output
        console.log('\n=== Extraction Results ===');
        console.log(JSON.stringify(output, null, 2));

        // Save output to file
        const outputPath = path.join(__dirname, 'output', 'nexrad_level2_file_output_js.json');
        await fs.writeFile(outputPath, JSON.stringify(output, null, 2));
        console.log(`\n✓ Output saved to: ${outputPath}`);

        // Summary
        console.log('\n=== NEXRADLevel2File Summary ===');
        console.log(`Location: ${JSON.stringify(output.location)}`);
        console.log(`VCP Pattern: ${output.vcp_pattern}`);
        console.log(`Total radial records: ${output.total_radial_records}`);
        console.log(`Available moments: ${Object.keys(output.moments).filter(m => output.moments[m].available)}`);
        console.log('\nAnalysis complete!');

    } catch (error) {
        console.error('Error during test:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
runTest();
