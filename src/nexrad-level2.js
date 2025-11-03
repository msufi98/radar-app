/**
 * NEXRAD Level 2 File Parser for JavaScript
 * Ported from PyART (Python ARM Radar Toolkit)
 * https://github.com/ARM-DOE/pyart
 */

import bzip2 from 'seek-bzip';

// Constants
const RECORD_SIZE = 2432;
const COMPRESSION_RECORD_SIZE = 12;
const CONTROL_WORD_SIZE = 4;

// Structure definitions matching Python format codes
// All NEXRAD data is big-endian
const STRUCTURES = {
    // Volume Header (Figure 1, page 7-2)
    VOLUME_HEADER: [
        { name: 'tape', type: 'string', length: 9 },
        { name: 'extension', type: 'string', length: 3 },
        { name: 'date', type: 'uint32' },
        { name: 'time', type: 'uint32' },
        { name: 'icao', type: 'string', length: 4 }
    ],

    // Message Header (Table II, page 3-7)
    MSG_HEADER: [
        { name: 'size', type: 'uint16' },      // size of data, not including header
        { name: 'channels', type: 'uint8' },
        { name: 'type', type: 'uint8' },
        { name: 'seq_id', type: 'uint16' },
        { name: 'date', type: 'uint16' },
        { name: 'ms', type: 'uint32' },
        { name: 'segments', type: 'uint16' },
        { name: 'seg_num', type: 'uint16' }
    ],

    // Message Type 31 Header (Table XVII, pages 3-87 to 3-89)
    MSG_31: [
        { name: 'id', type: 'string', length: 4 },              // 0-3
        { name: 'collect_ms', type: 'uint32' },                 // 4-7
        { name: 'collect_date', type: 'uint16' },               // 8-9
        { name: 'azimuth_number', type: 'uint16' },             // 10-11
        { name: 'azimuth_angle', type: 'float32' },             // 12-15
        { name: 'compress_flag', type: 'uint8' },               // 16
        { name: 'spare_0', type: 'uint8' },                     // 17
        { name: 'radial_length', type: 'uint16' },              // 18-19
        { name: 'azimuth_resolution', type: 'uint8' },          // 20
        { name: 'radial_spacing', type: 'uint8' },              // 21
        { name: 'elevation_number', type: 'uint8' },            // 22
        { name: 'cut_sector', type: 'uint8' },                  // 23
        { name: 'elevation_angle', type: 'float32' },           // 24-27
        { name: 'radial_blanking', type: 'uint8' },             // 28
        { name: 'azimuth_mode', type: 'int8' },                 // 29
        { name: 'block_count', type: 'uint16' },                // 30-31
        { name: 'block_pointer_1', type: 'uint32' },            // 32-35  Volume Data
        { name: 'block_pointer_2', type: 'uint32' },            // 36-39  Elevation Data
        { name: 'block_pointer_3', type: 'uint32' },            // 40-43  Radial Data
        { name: 'block_pointer_4', type: 'uint32' },            // 44-47  Moment "REF"
        { name: 'block_pointer_5', type: 'uint32' },            // 48-51  Moment "VEL"
        { name: 'block_pointer_6', type: 'uint32' },            // 52-55  Moment "SW"
        { name: 'block_pointer_7', type: 'uint32' },            // 56-59  Moment "ZDR"
        { name: 'block_pointer_8', type: 'uint32' },            // 60-63  Moment "PHI"
        { name: 'block_pointer_9', type: 'uint32' },            // 64-67  Moment "RHO"
        { name: 'block_pointer_10', type: 'uint32' }            // 68-71  Moment "CFP"
    ],

    // Message Type 1 (Legacy format - Table III)
    MSG_1: [
        { name: 'collect_ms', type: 'uint32' },                 // 0-3
        { name: 'collect_date', type: 'uint16' },               // 4-5
        { name: 'unambig_range', type: 'int16' },               // 6-7
        { name: 'azimuth_angle', type: 'uint16' },              // 8-9
        { name: 'azimuth_number', type: 'uint16' },             // 10-11
        { name: 'radial_status', type: 'uint16' },              // 12-13
        { name: 'elevation_angle', type: 'uint16' },            // 14-15
        { name: 'elevation_number', type: 'uint16' },           // 16-17
        { name: 'sur_range_first', type: 'uint16' },            // 18-19
        { name: 'doppler_range_first', type: 'uint16' },        // 20-21
        { name: 'sur_range_step', type: 'uint16' },             // 22-23
        { name: 'doppler_range_step', type: 'uint16' },         // 24-25
        { name: 'sur_nbins', type: 'uint16' },                  // 26-27
        { name: 'doppler_nbins', type: 'uint16' },              // 28-29
        { name: 'cut_sector_num', type: 'uint16' },             // 30-31
        { name: 'calib_const', type: 'float32' },               // 32-35
        { name: 'sur_pointer', type: 'uint16' },                // 36-37
        { name: 'vel_pointer', type: 'uint16' },                // 38-39
        { name: 'width_pointer', type: 'uint16' },              // 40-41
        { name: 'doppler_resolution', type: 'uint16' },         // 42-43
        { name: 'vcp', type: 'uint16' },                        // 44-45
        { name: 'spare_1', type: 'skip', length: 8 },           // 46-53
        { name: 'spare_2', type: 'skip', length: 2 },           // 54-55
        { name: 'spare_3', type: 'skip', length: 2 },           // 56-57
        { name: 'spare_4', type: 'skip', length: 2 },           // 58-59
        { name: 'nyquist_vel', type: 'int16' },                 // 60-61
        { name: 'atmos_attenuation', type: 'int16' },           // 62-63
        { name: 'threshold', type: 'int16' },                   // 64-65
        { name: 'spot_blank_status', type: 'uint16' },          // 66-67
        { name: 'spare_5', type: 'skip', length: 32 }           // 68-99
    ],

    // VCP Pattern Data (Message Type 5)
    MSG_5: [
        { name: 'msg_size', type: 'uint16' },
        { name: 'pattern_type', type: 'uint16' },
        { name: 'pattern_number', type: 'uint16' },
        { name: 'num_cuts', type: 'uint16' },
        { name: 'clutter_map_group', type: 'uint16' },
        { name: 'doppler_vel_res', type: 'uint8' },
        { name: 'pulse_width', type: 'uint8' },
        { name: 'spare', type: 'skip', length: 10 }
    ],

    MSG_5_ELEV: [
        { name: 'elevation_angle', type: 'uint16' },
        { name: 'channel_config', type: 'uint8' },
        { name: 'waveform_type', type: 'uint8' },
        { name: 'super_resolution', type: 'uint8' },
        { name: 'prf_number', type: 'uint8' },
        { name: 'prf_pulse_count', type: 'uint16' },
        { name: 'azimuth_rate', type: 'uint16' },
        { name: 'ref_thresh', type: 'int16' },
        { name: 'vel_thresh', type: 'int16' },
        { name: 'sw_thresh', type: 'int16' },
        { name: 'zdr_thres', type: 'int16' },
        { name: 'phi_thres', type: 'int16' },
        { name: 'rho_thres', type: 'int16' },
        { name: 'edge_angle_1', type: 'uint16' },
        { name: 'dop_prf_num_1', type: 'uint16' },
        { name: 'dop_prf_pulse_count_1', type: 'uint16' },
        { name: 'spare_1', type: 'skip', length: 2 },
        { name: 'edge_angle_2', type: 'uint16' },
        { name: 'dop_prf_num_2', type: 'uint16' },
        { name: 'dop_prf_pulse_count_2', type: 'uint16' },
        { name: 'spare_2', type: 'skip', length: 2 },
        { name: 'edge_angle_3', type: 'uint16' },
        { name: 'dop_prf_num_3', type: 'uint16' },
        { name: 'dop_prf_pulse_count_3', type: 'uint16' },
        { name: 'spare_3', type: 'skip', length: 2 }
    ],

    // Generic Data Block (Table XVII-B)
    GENERIC_DATA_BLOCK: [
        { name: 'block_type', type: 'string', length: 1 },
        { name: 'data_name', type: 'string', length: 3 },
        { name: 'reserved', type: 'uint32' },
        { name: 'ngates', type: 'uint16' },
        { name: 'first_gate', type: 'int16' },
        { name: 'gate_spacing', type: 'int16' },
        { name: 'thresh', type: 'int16' },
        { name: 'snr_thres', type: 'int16' },
        { name: 'flags', type: 'uint8' },
        { name: 'word_size', type: 'uint8' },
        { name: 'scale', type: 'float32' },
        { name: 'offset', type: 'float32' }
    ],

    // Volume Data Block (Table XVII-E)
    VOLUME_DATA_BLOCK: [
        { name: 'block_type', type: 'string', length: 1 },
        { name: 'data_name', type: 'string', length: 3 },
        { name: 'lrtup', type: 'uint16' },
        { name: 'version_major', type: 'uint8' },
        { name: 'version_minor', type: 'uint8' },
        { name: 'lat', type: 'float32' },
        { name: 'lon', type: 'float32' },
        { name: 'height', type: 'int16' },
        { name: 'feedhorn_height', type: 'uint16' },
        { name: 'refl_calib', type: 'float32' },
        { name: 'power_h', type: 'float32' },
        { name: 'power_v', type: 'float32' },
        { name: 'diff_refl_calib', type: 'float32' },
        { name: 'init_phase', type: 'float32' },
        { name: 'vcp', type: 'uint16' },
        { name: 'spare', type: 'skip', length: 2 }
    ],

    // Elevation Data Block (Table XVII-F)
    ELEVATION_DATA_BLOCK: [
        { name: 'block_type', type: 'string', length: 1 },
        { name: 'data_name', type: 'string', length: 3 },
        { name: 'lrtup', type: 'uint16' },
        { name: 'atmos', type: 'int16' },
        { name: 'refl_calib', type: 'float32' }
    ],

    // Radial Data Block (Table XVII-H)
    RADIAL_DATA_BLOCK: [
        { name: 'block_type', type: 'string', length: 1 },
        { name: 'data_name', type: 'string', length: 3 },
        { name: 'lrtup', type: 'uint16' },
        { name: 'unambig_range', type: 'int16' },
        { name: 'noise_h', type: 'float32' },
        { name: 'noise_v', type: 'float32' },
        { name: 'nyquist_vel', type: 'int16' },
        { name: 'spare', type: 'skip', length: 2 }
    ]
};

/**
 * Calculate the size of a structure in bytes
 */
function structureSize(structure) {
    let size = 0;
    for (const field of structure) {
        if (field.type === 'string' || field.type === 'skip') {
            size += field.length;
        } else if (field.type === 'uint8' || field.type === 'int8') {
            size += 1;
        } else if (field.type === 'uint16' || field.type === 'int16') {
            size += 2;
        } else if (field.type === 'uint32' || field.type === 'int32' || field.type === 'float32') {
            size += 4;
        } else if (field.type === 'float64') {
            size += 8;
        }
    }
    return size;
}

/**
 * Unpack a structure from a buffer at a given position
 * All NEXRAD data is big-endian
 */
function unpackStructure(buffer, offset, structure) {
    const view = new DataView(buffer);
    const result = {};
    let pos = offset;

    for (const field of structure) {
        if (field.type === 'string') {
            const bytes = new Uint8Array(buffer, pos, field.length);
            result[field.name] = new TextDecoder('ascii').decode(bytes);
            pos += field.length;
        } else if (field.type === 'skip') {
            pos += field.length;
        } else if (field.type === 'uint8') {
            result[field.name] = view.getUint8(pos);
            pos += 1;
        } else if (field.type === 'int8') {
            result[field.name] = view.getInt8(pos);
            pos += 1;
        } else if (field.type === 'uint16') {
            result[field.name] = view.getUint16(pos, false); // big-endian
            pos += 2;
        } else if (field.type === 'int16') {
            result[field.name] = view.getInt16(pos, false); // big-endian
            pos += 2;
        } else if (field.type === 'uint32') {
            result[field.name] = view.getUint32(pos, false); // big-endian
            pos += 4;
        } else if (field.type === 'int32') {
            result[field.name] = view.getInt32(pos, false); // big-endian
            pos += 4;
        } else if (field.type === 'float32') {
            result[field.name] = view.getFloat32(pos, false); // big-endian
            pos += 4;
        } else if (field.type === 'float64') {
            result[field.name] = view.getFloat64(pos, false); // big-endian
            pos += 8;
        }
    }

    return result;
}

/**
 * NEXRAD Level 2 File Parser Class
 */
export class NEXRADLevel2File {
    constructor(arrayBuffer) {
        this.buffer = arrayBuffer;
        this.volumeHeader = null;
        this.records = [];
        this.radialRecords = [];
        this.msgType = null;
        this.nscans = 0;
        this.scans = []; // Array of scan indices
        this.vcp = null; // VCP information

        this._parse();
    }

    /**
     * Parse the NEXRAD Level 2 file
     */
    _parse() {
        console.log('Parsing NEXRAD Level 2 file...');

        // Read volume header
        const volumeHeaderSize = structureSize(STRUCTURES.VOLUME_HEADER);
        this.volumeHeader = unpackStructure(
            this.buffer,
            0,
            STRUCTURES.VOLUME_HEADER
        );

        console.log('Volume header:', this.volumeHeader);

        // Read compression record
        const compressionRecord = new Uint8Array(
            this.buffer,
            volumeHeaderSize,
            COMPRESSION_RECORD_SIZE
        );

        // Check compression (bytes 4-5 after control word)
        const compressionSlice = compressionRecord.slice(
            CONTROL_WORD_SIZE,
            CONTROL_WORD_SIZE + 2
        );

        let decompressedBuffer;

        if (compressionSlice[0] === 0x42 && compressionSlice[1] === 0x5A) { // "BZ"
            console.log('File is BZ2 compressed, decompressing...');
            decompressedBuffer = this._decompressRecords();
        } else if ((compressionSlice[0] === 0x00 && compressionSlice[1] === 0x00) ||
                   (compressionSlice[0] === 0x09 && compressionSlice[1] === 0x80)) {
            console.log('File is uncompressed');
            // Skip volume header and read rest
            decompressedBuffer = this.buffer.slice(volumeHeaderSize + COMPRESSION_RECORD_SIZE);
        } else {
            throw new Error('Unknown compression format');
        }

        // Parse records
        this._parseRecords(decompressedBuffer);

        // Extract radial records (message type 31)
        this.radialRecords = this.records.filter(r => r.header && r.header.type === 31);
        this.msgType = '31';

        // If no type 31 messages, look for type 1
        if (this.radialRecords.length === 0) {
            this.radialRecords = this.records.filter(r => r.header && r.header.type === 1);
            this.msgType = '1';
        }

        // Find VCP record (Message Type 5)
        const vcpRecord = this.records.find(r => r.header && r.header.type === 5);
        if (vcpRecord) {
            this.vcp = vcpRecord;
        }

        // Group radials into scans by elevation angle
        this._identifyScans();

        console.log(`Parsed ${this.records.length} records, ${this.radialRecords.length} radial records (type ${this.msgType}), ${this.nscans} scans`);
    }

    /**
     * Decompress BZ2 compressed records
     * Mirrors PyART's _decompress_records function
     *
     * PyART implementation:
     * 1. Skip volume header + control word
     * 2. Decompress first block
     * 3. While there's unused_data (more blocks):
     *    - Skip control word (4 bytes)
     *    - Decompress next block
     *    - Append to buffer
     * 4. Return buffer minus compression record size
     *
     * NEXRAD files contain multiple BZ2 streams with control words between them.
     * We need to remove these control words and concatenate the streams before decompressing.
     */
    _decompressRecords() {
        // Skip volume header (24 bytes) + first control word (4 bytes)
        const skip = structureSize(STRUCTURES.VOLUME_HEADER) + CONTROL_WORD_SIZE;
        const compressedData = new Uint8Array(this.buffer.slice(skip));

        console.log(`Starting decompression of ${compressedData.length} bytes...`);

        // Find all BZ2 blocks and remove control words between them
        // BZ2 header is: 'BZ' + 'h' + block_size (1-9)
        // Full header: 0x42 0x5a 0x68 0x31-0x39
        const cleanedBlocks = [];
        let offset = 0;
        let blockNum = 0;

        while (offset < compressedData.length - 10) {
            // Check for proper BZ2 stream header: "BZh" followed by block size (1-9)
            if (compressedData[offset] === 0x42 &&  // 'B'
                compressedData[offset + 1] === 0x5a &&  // 'Z'
                compressedData[offset + 2] === 0x68 &&  // 'h'
                compressedData[offset + 3] >= 0x31 &&  // '1'
                compressedData[offset + 3] <= 0x39) {  // '9'

                blockNum++;

                // Find the end of this BZ2 stream by looking for the next BZ header
                let blockEnd = compressedData.length;
                for (let i = offset + 100; i < compressedData.length - 9; i++) {
                    // Look for pattern: any 4 bytes (control word) + "BZh" + digit
                    if (i + 7 < compressedData.length &&
                        compressedData[i + 4] === 0x42 &&  // 'B'
                        compressedData[i + 5] === 0x5a &&  // 'Z'
                        compressedData[i + 6] === 0x68 &&  // 'h'
                        compressedData[i + 7] >= 0x31 &&  // '1'
                        compressedData[i + 7] <= 0x39) {  // '9'
                        blockEnd = i;  // End before the control word
                        break;
                    }
                }

                const block = compressedData.slice(offset, blockEnd);
                cleanedBlocks.push(block);
                console.log(`Found BZ2 block ${blockNum}: ${block.length} bytes (at offset ${offset})`);

                // Move to next block (skip control word)
                offset = blockEnd + CONTROL_WORD_SIZE;
            } else {
                offset++;
            }
        }

        // Decompress each BZ2 block separately (they are independent streams)
        console.log(`Decompressing ${cleanedBlocks.length} BZ2 blocks separately...`);
        const decompressedChunks = [];

        for (let i = 0; i < cleanedBlocks.length; i++) {
            try {
                const decompressed = bzip2.decode(cleanedBlocks[i]);
                decompressedChunks.push(decompressed);
                console.log(`Block ${i + 1}: Decompressed ${cleanedBlocks[i].length} -> ${decompressed.length} bytes`);
            } catch (e) {
                console.error(`Block ${i + 1}: Decompression error - ${e.message}`);
            }
        }

        // Concatenate all decompressed chunks
        const totalLength = decompressedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
        console.log(`Total decompressed: ${totalLength} bytes from ${decompressedChunks.length} blocks`);

        const result = new Uint8Array(totalLength);
        let position = 0;
        for (const chunk of decompressedChunks) {
            result.set(chunk, position);
            position += chunk.length;
        }

        // Skip compression record size from decompressed data and return
        return result.buffer.slice(COMPRESSION_RECORD_SIZE);
    }

    /**
     * Parse records from decompressed buffer
     */
    _parseRecords(buffer) {
        let pos = 0;
        const bufLength = buffer.byteLength;

        while (pos < bufLength) {
            const result = this._getRecordFromBuffer(buffer, pos);
            if (!result) break;

            pos = result.newPos;
            this.records.push(result.record);
        }
    }

    /**
     * Get a single record from buffer
     */
    _getRecordFromBuffer(buffer, pos) {
        if (pos + structureSize(STRUCTURES.MSG_HEADER) > buffer.byteLength) {
            return null;
        }

        const record = {
            header: unpackStructure(buffer, pos, STRUCTURES.MSG_HEADER)
        };

        const msgType = record.header.type;
        let newPos = pos;

        if (msgType === 31) {
            newPos = this._parseMsg31(buffer, pos, record);
        } else if (msgType === 1) {
            newPos = this._parseMsg1(buffer, pos, record);
        } else if (msgType === 5) {
            newPos = this._parseMsg5(buffer, pos, record);
        } else {
            // Unknown message type, skip record
            newPos = pos + RECORD_SIZE;
        }

        return { newPos, record };
    }

    /**
     * Parse Message Type 31 (Modern format)
     */
    _parseMsg31(buffer, pos, record) {
        const msgSize = record.header.size * 2 - 4;
        const msgHeaderSize = structureSize(STRUCTURES.MSG_HEADER);
        const newPos = pos + msgHeaderSize + msgSize;

        if (newPos > buffer.byteLength) {
            return pos + RECORD_SIZE;
        }

        const msgBuffer = buffer.slice(pos + msgHeaderSize, newPos);
        const msg31Header = unpackStructure(msgBuffer, 0, STRUCTURES.MSG_31);

        record.msg_header = msg31Header;

        // Get block pointers
        const blockPointers = [];
        for (let i = 1; i <= 10; i++) {
            const ptr = msg31Header[`block_pointer_${i}`];
            if (ptr > 0) {
                blockPointers.push(ptr);
            }
        }

        // Parse data blocks
        for (const ptr of blockPointers) {
            const { blockName, blockData } = this._parseMsg31DataBlock(msgBuffer, ptr);
            if (blockName) {
                record[blockName] = blockData;
            }
        }

        return newPos;
    }

    /**
     * Parse Message 31 data block
     */
    _parseMsg31DataBlock(buffer, ptr) {
        if (ptr + 4 > buffer.byteLength) {
            return { blockName: null, blockData: null };
        }

        const nameBytes = new Uint8Array(buffer.slice(ptr + 1, ptr + 4));
        const blockName = new TextDecoder('ascii').decode(nameBytes).trim();

        let blockData = {};

        if (blockName === 'VOL') {
            blockData = unpackStructure(buffer, ptr, STRUCTURES.VOLUME_DATA_BLOCK);
        } else if (blockName === 'ELV') {
            blockData = unpackStructure(buffer, ptr, STRUCTURES.ELEVATION_DATA_BLOCK);
        } else if (blockName === 'RAD') {
            blockData = unpackStructure(buffer, ptr, STRUCTURES.RADIAL_DATA_BLOCK);
        } else if (['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'].includes(blockName)) {
            blockData = unpackStructure(buffer, ptr, STRUCTURES.GENERIC_DATA_BLOCK);
            const ngates = blockData.ngates;
            const dataPtr = ptr + structureSize(STRUCTURES.GENERIC_DATA_BLOCK);

            if (blockData.word_size === 16) {
                const data = new Uint16Array(buffer.slice(dataPtr, dataPtr + ngates * 2));
                // Convert to big-endian if needed
                blockData.data = Array.from(data).map((val, i) => {
                    const view = new DataView(buffer, dataPtr + i * 2, 2);
                    return view.getUint16(0, false);
                });
            } else if (blockData.word_size === 8) {
                blockData.data = Array.from(new Uint8Array(buffer.slice(dataPtr, dataPtr + ngates)));
            }
        }

        return { blockName, blockData };
    }

    /**
     * Parse Message Type 1 (Legacy format)
     */
    _parseMsg1(buffer, pos, record) {
        const msgHeaderSize = structureSize(STRUCTURES.MSG_HEADER);
        const msg1Header = unpackStructure(buffer, pos + msgHeaderSize, STRUCTURES.MSG_1);

        record.msg_header = msg1Header;

        // Parse reflectivity
        if (msg1Header.sur_pointer) {
            const offset = pos + msgHeaderSize + msg1Header.sur_pointer;
            const data = Array.from(new Uint8Array(buffer.slice(offset, offset + msg1Header.sur_nbins)));
            record.REF = {
                ngates: msg1Header.sur_nbins,
                gate_spacing: msg1Header.sur_range_step,
                first_gate: msg1Header.sur_range_first,
                data: data,
                scale: 2.0,
                offset: 66.0
            };
        }

        // Parse velocity
        if (msg1Header.vel_pointer) {
            const offset = pos + msgHeaderSize + msg1Header.vel_pointer;
            const data = Array.from(new Uint8Array(buffer.slice(offset, offset + msg1Header.doppler_nbins)));
            const scale = msg1Header.doppler_resolution === 4 ? 1.0 : 2.0;

            record.VEL = {
                ngates: msg1Header.doppler_nbins,
                gate_spacing: msg1Header.doppler_range_step,
                first_gate: msg1Header.doppler_range_first,
                data: data,
                scale: scale,
                offset: 129.0
            };
        }

        // Parse spectrum width
        if (msg1Header.width_pointer) {
            const offset = pos + msgHeaderSize + msg1Header.width_pointer;
            const data = Array.from(new Uint8Array(buffer.slice(offset, offset + msg1Header.doppler_nbins)));
            record.SW = {
                ngates: msg1Header.doppler_nbins,
                gate_spacing: msg1Header.doppler_range_step,
                first_gate: msg1Header.doppler_range_first,
                data: data,
                scale: 2.0,
                offset: 129.0
            };
        }

        return pos + RECORD_SIZE;
    }

    /**
     * Parse Message Type 5 (VCP information)
     */
    _parseMsg5(buffer, pos, record) {
        const msgHeaderSize = structureSize(STRUCTURES.MSG_HEADER);
        const msg5HeaderSize = structureSize(STRUCTURES.MSG_5);
        const msg5ElevSize = structureSize(STRUCTURES.MSG_5_ELEV);

        record.msg5_header = unpackStructure(buffer, pos + msgHeaderSize, STRUCTURES.MSG_5);
        record.cut_parameters = [];

        for (let i = 0; i < record.msg5_header.num_cuts; i++) {
            const elevPos = pos + msgHeaderSize + msg5HeaderSize + msg5ElevSize * i;
            if (elevPos + msg5ElevSize <= buffer.byteLength) {
                record.cut_parameters.push(
                    unpackStructure(buffer, elevPos, STRUCTURES.MSG_5_ELEV)
                );
            }
        }

        return pos + RECORD_SIZE;
    }

    /**
     * Get radar location (latitude, longitude, height)
     */
    location() {
        // Look for VOL block in radial records
        for (const record of this.radialRecords) {
            if (record.VOL) {
                return {
                    lat: record.VOL.lat,
                    lon: record.VOL.lon,
                    height: record.VOL.height
                };
            }
        }
        return null;
    }

    /**
     * Get VCP pattern number
     */
    getVCPPattern() {
        // Check for VCP in VOL block
        for (const record of this.radialRecords) {
            if (record.VOL && record.VOL.vcp) {
                return record.VOL.vcp;
            }
        }

        // Check Message Type 5 records
        for (const record of this.records) {
            if (record.msg5_header) {
                return record.msg5_header.pattern_number;
            }
        }

        // Check Message Type 1 records
        if (this.msgType === '1' && this.radialRecords.length > 0) {
            const firstRecord = this.radialRecords[0];
            if (firstRecord.msg_header && firstRecord.msg_header.vcp) {
                return firstRecord.msg_header.vcp;
            }
        }

        return null;
    }

    /**
     * Get basic file information
     */
    getInfo() {
        const location = this.location();
        const vcp = this.getVCPPattern();

        return {
            siteID: this.volumeHeader.icao.trim(),
            date: this._formatDate(this.volumeHeader.date),
            time: this._formatTime(this.volumeHeader.time),
            vcp: vcp,
            messageCount: this.records.length,
            radialCount: this.radialRecords.length,
            messageType: this.msgType,
            location: location
        };
    }

    /**
     * Format date from Modified Julian date
     */
    _formatDate(mjd) {
        // Modified Julian Date starts from Nov 17, 1858
        const baseDate = new Date(1858, 10, 17);
        const date = new Date(baseDate.getTime() + mjd * 86400000);
        return date.toISOString().split('T')[0];
    }

    /**
     * Format time from milliseconds since midnight
     */
    _formatTime(ms) {
        const hours = Math.floor(ms / 3600000);
        const minutes = Math.floor((ms % 3600000) / 60000);
        const seconds = Math.floor((ms % 60000) / 1000);
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')} UTC`;
    }

    /**
     * Identify scans by grouping radials with similar elevation angles
     */
    _identifyScans() {
        if (this.radialRecords.length === 0) {
            this.nscans = 0;
            this.scans = [];
            return;
        }

        // Group by elevation number or angle
        const elevationGroups = new Map();

        for (let i = 0; i < this.radialRecords.length; i++) {
            const record = this.radialRecords[i];
            const header = record.msg_header;

            if (!header) continue;

            const elevNum = header.elevation_number;

            if (!elevationGroups.has(elevNum)) {
                elevationGroups.set(elevNum, []);
            }

            elevationGroups.get(elevNum).push(i);
        }

        // Sort by elevation number and create scan index array
        const sortedElevations = Array.from(elevationGroups.keys()).sort((a, b) => a - b);

        this.scans = [];
        for (const elevNum of sortedElevations) {
            this.scans.push({
                elevation_number: elevNum,
                indices: elevationGroups.get(elevNum)
            });
        }

        this.nscans = this.scans.length;
    }

    /**
     * Get scan information
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<Object>} Array of scan info objects
     */
    scan_info(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const info = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            const radialIndices = scan.indices;

            if (radialIndices.length === 0) continue;

            const firstRadial = this.radialRecords[radialIndices[0]];

            // Identify available moments
            const moments = [];
            const momentFields = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP'];

            for (const moment of momentFields) {
                if (firstRadial[moment]) {
                    moments.push(moment);
                }
            }

            // Get gate information for each moment
            const ngates = {};
            const gate_spacing = {};
            const first_gate = {};

            for (const moment of moments) {
                const momentData = firstRadial[moment];
                ngates[moment] = momentData.ngates || 0;
                gate_spacing[moment] = momentData.gate_spacing || 0;
                first_gate[moment] = momentData.first_gate || 0;
            }

            info.push({
                moments: moments,
                ngates: ngates,
                nrays: radialIndices.length,
                gate_spacing: gate_spacing,
                first_gate: first_gate
            });
        }

        return info;
    }

    /**
     * Get number of rays in a scan
     * @param {number} scan - Scan index
     * @returns {number} Number of rays
     */
    get_nrays(scan) {
        if (scan >= this.nscans) return 0;
        return this.scans[scan].indices.length;
    }

    /**
     * Get collection times for rays
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Object} Object with 'time' (base datetime) and 'time_offset' (array of offsets in seconds)
     */
    get_times(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);

        // Get base time from volume header
        const baseDate = this._formatDate(this.volumeHeader.date);
        const baseTime = this.volumeHeader.time;

        const times = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];
                const header = record.msg_header;

                if (header && header.collect_ms !== undefined) {
                    // Calculate offset from base time in seconds
                    const offset = (header.collect_ms - baseTime) / 1000.0;
                    times.push(offset);
                }
            }
        }

        return {
            time: baseDate + ' ' + this._formatTime(baseTime),
            time_offset: times
        };
    }

    /**
     * Get azimuth angles for rays
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<number>} Array of azimuth angles in degrees
     */
    get_azimuth_angles(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const angles = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];
                const header = record.msg_header;

                if (header && header.azimuth_angle !== undefined) {
                    angles.push(header.azimuth_angle);
                }
            }
        }

        return angles;
    }

    /**
     * Get elevation angles for rays
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<number>} Array of elevation angles in degrees
     */
    get_elevation_angles(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const angles = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];
                const header = record.msg_header;

                if (header && header.elevation_angle !== undefined) {
                    angles.push(header.elevation_angle);
                }
            }
        }

        return angles;
    }

    /**
     * Get target elevation angles from VCP
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<number>} Array of target elevation angles in degrees
     */
    get_target_angles(scans = null) {
        if (!this.vcp || !this.vcp.cut_parameters) {
            return [];
        }

        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const angles = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx < this.vcp.cut_parameters.length) {
                const cutParam = this.vcp.cut_parameters[scanIdx];
                // Convert from scaled integer to degrees (factor of 360/65536)
                const angle = (cutParam.elevation_angle * 360.0) / 65536.0;
                angles.push(angle);
            }
        }

        return angles;
    }

    /**
     * Get Nyquist velocities
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<number>} Array of Nyquist velocities in m/s
     */
    get_nyquist_vel(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const velocities = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];

                if (this.msgType === '31' && record.RAD) {
                    // Message 31: Nyquist velocity in RAD block (scaled by 100)
                    velocities.push(record.RAD.nyquist_vel / 100.0);
                } else if (this.msgType === '1' && record.msg_header) {
                    // Message 1: Nyquist velocity in message header (scaled by 100)
                    velocities.push(record.msg_header.nyquist_vel / 100.0);
                } else {
                    velocities.push(null);
                }
            }
        }

        return velocities;
    }

    /**
     * Get unambiguous range
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @returns {Array<number>} Array of unambiguous ranges in meters
     */
    get_unambigous_range(scans = null) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const ranges = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];

                if (this.msgType === '31' && record.RAD) {
                    // Message 31: Unambiguous range in RAD block (in decameters, convert to meters)
                    ranges.push(record.RAD.unambig_range * 10.0);
                } else if (this.msgType === '1' && record.msg_header) {
                    // Message 1: Unambiguous range in message header (in decameters, convert to meters)
                    ranges.push(record.msg_header.unambig_range * 10.0);
                } else {
                    ranges.push(null);
                }
            }
        }

        return ranges;
    }

    /**
     * Get range array for a moment
     * @param {number} scan_num - Scan index
     * @param {string} moment - Moment name (e.g., 'REF', 'VEL')
     * @returns {Array<number>} Array of ranges in meters from antenna to bin center
     */
    get_range(scan_num, moment) {
        if (scan_num >= this.nscans) return [];

        const scan = this.scans[scan_num];
        const radialIndices = scan.indices;

        if (radialIndices.length === 0) return [];

        const firstRadial = this.radialRecords[radialIndices[0]];
        const momentData = firstRadial[moment];

        if (!momentData) {
            throw new Error(`'${moment}'`);
        }

        const ngates = momentData.ngates;
        const first_gate = momentData.first_gate; // in meters
        const gate_spacing = momentData.gate_spacing; // in meters

        // Calculate range to center of each gate
        const ranges = [];
        for (let i = 0; i < ngates; i++) {
            ranges.push(first_gate + i * gate_spacing);
        }

        return ranges;
    }

    /**
     * Get moment data
     * @param {string} moment - Moment name (e.g., 'REF', 'VEL', 'SW')
     * @param {number} max_ngates - Maximum number of gates
     * @param {Array<number>|null} scans - Array of scan indices or null for all scans
     * @param {boolean} raw_data - If true, return raw unscaled data
     * @returns {Array<Array<number>>} 2D array of moment data [nrays, max_ngates]
     */
    get_data(moment, max_ngates, scans = null, raw_data = false) {
        const scanIndices = scans !== null ? scans : Array.from({ length: this.nscans }, (_, i) => i);
        const data = [];

        for (const scanIdx of scanIndices) {
            if (scanIdx >= this.nscans) continue;

            const scan = this.scans[scanIdx];
            for (const radialIdx of scan.indices) {
                const record = this.radialRecords[radialIdx];
                const momentData = record[moment];

                if (!momentData || !momentData.data) {
                    // No data for this moment, fill with masked values
                    data.push(Array(max_ngates).fill(null));
                    continue;
                }

                const row = [];
                const scale = momentData.scale || 1.0;
                const offset = momentData.offset || 0.0;
                const rawData = momentData.data;

                for (let i = 0; i < max_ngates; i++) {
                    if (i < rawData.length) {
                        const rawValue = rawData[i];

                        // Check for missing data indicators (0 or 1 typically indicate no data)
                        if (rawValue === 0 || rawValue === 1) {
                            row.push(null);
                        } else if (raw_data) {
                            row.push(rawValue);
                        } else {
                            // Apply scaling: value = (raw - offset) / scale
                            const scaled = (rawValue - offset) / scale;
                            row.push(scaled);
                        }
                    } else {
                        row.push(null);
                    }
                }

                data.push(row);
            }
        }

        return data;
    }
}

export default NEXRADLevel2File;
