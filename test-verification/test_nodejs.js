/**
 * NEXRAD Level 2 Parser Verification - Node.js
 * Tests the JavaScript nexrad-level2.js implementation
 */

import { NEXRADLevel2File } from '../src/nexrad-level2.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import https from 'https';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Download file from S3
 */
async function downloadFromS3(fileKey) {
    const url = `https://s3.amazonaws.com/unidata-nexrad-level2/${fileKey}`;
    const localPath = path.join(__dirname, 'data', 'sample_nexrad.ar2v');

    console.log(`Downloading: ${url}`);

    return new Promise((resolve, reject) => {
        https.get(url, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: ${response.statusCode}`));
                return;
            }

            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', async () => {
                const buffer = Buffer.concat(chunks);
                await fs.writeFile(localPath, buffer);
                console.log(`Downloaded to: ${localPath}`);
                resolve(buffer);
            });
            response.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Main test function
 */
async function runTest() {
    try {
        console.log('=== NEXRAD Level 2 Parser Test (Node.js) ===\n');

        // Check if we have test file info from Python
        let fileKey = '2013/05/06/KABR/KABR20130506_000229_V06';
        let buffer;

        try {
            const fileInfo = JSON.parse(
                await fs.readFile(path.join(__dirname, 'data', 'test_file_info.json'), 'utf8')
            );
            fileKey = fileInfo.key;
            console.log(`Using file from Python test: ${fileKey}\n`);

            // Try to read local file first
            try {
                buffer = await fs.readFile(path.join(__dirname, 'data', 'sample_nexrad.ar2v'));
                console.log('Using local file from Python test\n');
            } catch (e) {
                console.log('Local file not found, downloading...\n');
                buffer = await downloadFromS3(fileKey);
            }
        } catch (e) {
            console.log('No Python test file info found, using default file\n');
            buffer = await downloadFromS3(fileKey);
        }

        // Save file info
        await fs.writeFile(
            path.join(__dirname, 'data', 'test_file_info.json'),
            JSON.stringify({ key: fileKey, local_path: 'data/sample_nexrad.ar2v' }, null, 2)
        );

        // Parse the file
        console.log('Parsing NEXRAD file...\n');
        const nexradFile = new NEXRADLevel2File(buffer.buffer);

        console.log('File parsed successfully!\n');

        // Extract key information
        const output = {
            volume_header: {
                tape: nexradFile.volumeHeader.tape,
                extension: nexradFile.volumeHeader.extension,
                date: nexradFile.volumeHeader.date,
                time: nexradFile.volumeHeader.time,
                icao: nexradFile.volumeHeader.icao.trim()
            },
            total_records: nexradFile.records.length,
            radial_records: nexradFile.radialRecords.length,
            message_type: nexradFile.msgType,
            vcp_pattern: nexradFile.getVCPPattern(),
            location: nexradFile.location(),
            first_record_header: {},
            first_radial_header: {},
            moment_info: {}
        };

        // Get first record info
        if (nexradFile.records.length > 0) {
            const firstRec = nexradFile.records[0];
            if (firstRec.header) {
                output.first_record_header = firstRec.header;
            }
        }

        // Get first radial record info
        if (nexradFile.radialRecords.length > 0) {
            const firstRadial = nexradFile.radialRecords[0];
            if (firstRadial.msg_header) {
                output.first_radial_header = firstRadial.msg_header;
            }

            // Get moment information
            for (const moment of ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO']) {
                if (firstRadial[moment]) {
                    const momData = firstRadial[moment];
                    output.moment_info[moment] = {
                        ngates: momData.ngates || 0,
                        first_gate: momData.first_gate || 0,
                        gate_spacing: momData.gate_spacing || 0,
                        scale: momData.scale || 0,
                        offset: momData.offset || 0,
                        data_length: momData.data ? momData.data.length : 0,
                        data_sample: momData.data ? momData.data.slice(0, 10) : []
                    };
                }
            }
        }

        // Print output
        console.log('=== Extraction Results ===');
        console.log(JSON.stringify(output, null, 2));

        // Save output to file
        await fs.writeFile(
            path.join(__dirname, 'output', 'nodejs_output.json'),
            JSON.stringify(output, null, 2)
        );
        console.log('\n✓ Output saved to: output/nodejs_output.json');

        // Additional detailed analysis
        console.log('\n=== Detailed Analysis ===');
        console.log(`Total records: ${nexradFile.records.length}`);
        console.log(`Radial records: ${nexradFile.radialRecords.length}`);
        console.log(`Message type: ${nexradFile.msgType}`);

        // Count message types
        const msgTypes = {};
        for (const rec of nexradFile.records) {
            const msgType = rec.header?.type || 'unknown';
            msgTypes[msgType] = (msgTypes[msgType] || 0) + 1;
        }

        console.log('\nMessage type distribution:');
        for (const [msgType, count] of Object.entries(msgTypes).sort()) {
            console.log(`  Type ${msgType}: ${count} records`);
        }

        // Sample radial data
        if (nexradFile.radialRecords.length > 0) {
            console.log('\nFirst radial record details:');
            const firstRadial = nexradFile.radialRecords[0];
            const moments = Object.keys(firstRadial).filter(
                k => !['header', 'msg_header'].includes(k)
            );
            console.log(`  Available moments: ${JSON.stringify(moments)}`);

            if (firstRadial.VOL) {
                console.log(`  VOL block found:`, firstRadial.VOL);
            }
            if (firstRadial.ELV) {
                console.log(`  ELV block found:`, firstRadial.ELV);
            }
            if (firstRadial.RAD) {
                console.log(`  RAD block found:`, firstRadial.RAD);
            }
        }

        console.log('\n✓ Test completed successfully!');

    } catch (error) {
        console.error('Error during test:', error);
        console.error(error.stack);
        process.exit(1);
    }
}

// Run the test
runTest();
