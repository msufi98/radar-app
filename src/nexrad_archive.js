/**
 * NEXRAD Level 2 Archive File Reader (mirrors pyart.io.nexrad_archive)
 *
 * Read data from NEXRAD Level II archive files.
 */

import { prepare_for_read } from './common.js';
import { NEXRADLevel2File } from './nexrad-level2.js';

/**
 * Read a NEXRAD Level 2 archive file (mirrors pyart.io.read_nexrad_archive)
 *
 * @param {string} filename - Filename or S3 URI of NEXRAD Level 2 archive file
 * @param {Array<string>|null} field_names - Not yet implemented
 * @param {Object|null} additional_metadata - Not yet implemented
 * @param {boolean} file_field_names - Not yet implemented
 * @param {Array<string>|null} exclude_fields - Not yet implemented
 * @param {Array<string>|null} include_fields - Not yet implemented
 * @param {boolean} delay_field_loading - Not yet implemented
 * @param {string|null} station - Not yet implemented
 * @param {Array<number>|null} scans - Scans to extract, null for all scans
 * @param {boolean} linear_interp - Not yet implemented
 * @param {Object} storage_options - Storage options for S3 ({anon: true} for anonymous)
 * @returns {Promise<NEXRADLevel2File>} - NEXRADLevel2File instance
 */
export async function read_nexrad_archive(
    filename,
    {
        field_names = null,
        additional_metadata = null,
        file_field_names = false,
        exclude_fields = null,
        include_fields = null,
        delay_field_loading = false,
        station = null,
        scans = null,
        linear_interp = true,
        storage_options = { anon: true }
    } = {}
) {
    console.log(`Reading NEXRAD archive: ${filename}`);

    // Prepare file for reading (handles S3 download and decompression)
    const buffer = await prepare_for_read(filename, storage_options);

    // Parse the NEXRAD Level 2 file
    const nexrad_file = new NEXRADLevel2File(buffer);

    console.log(`Successfully read NEXRAD archive:`);
    console.log(`  - Site ID: ${nexrad_file.volumeHeader.icao.trim()}`);
    console.log(`  - VCP: ${nexrad_file.getVCPPattern()}`);
    console.log(`  - Scans: ${nexrad_file.nscans}`);
    console.log(`  - Total radials: ${nexrad_file.radialRecords.length}`);

    return nexrad_file;
}

export default { read_nexrad_archive };
