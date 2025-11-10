/**
 * Common I/O utilities for NEXRAD files (browser-compatible version)
 */

import pako from 'pako';

/**
 * Prepare a file for reading (browser-compatible version)
 * Handles S3 URIs via CORS proxy and decompresses gzip files
 *
 * @param {string} filename - S3 URI (s3://bucket/key) or HTTP URL
 * @param {Object} storage_options - Storage options for S3 access (e.g., {anon: true})
 * @returns {Promise<ArrayBuffer>} - File contents as ArrayBuffer
 */
export async function prepare_for_read(filename, storage_options = { anon: true }) {
    let buffer;

    // Check if S3 URI
    if (filename.startsWith('s3://')) {
        console.log(`Downloading from S3: ${filename}`);
        buffer = await _download_from_s3(filename, storage_options);
    } else if (filename.startsWith('http://') || filename.startsWith('https://')) {
        // Direct HTTP/HTTPS URL
        console.log(`Downloading from URL: ${filename}`);
        const response = await fetch(filename);
        if (!response.ok) {
            throw new Error(`Failed to download: ${response.status} ${response.statusText}`);
        }
        buffer = await response.arrayBuffer();
    } else {
        // Browser cannot read local files directly
        throw new Error('Local file access not supported in browser. Please use S3 URIs or HTTP URLs.');
    }

    // Check for gzip compression (magic bytes: 0x1f 0x8b)
    const uint8Buffer = new Uint8Array(buffer);
    if (uint8Buffer.length >= 2 && uint8Buffer[0] === 0x1f && uint8Buffer[1] === 0x8b) {
        console.log('File is gzip compressed, decompressing...');
        try {
            // Use pako to decompress gzip data
            const decompressed = pako.inflate(uint8Buffer);
            buffer = decompressed.buffer;
            console.log(`Decompressed size: ${buffer.byteLength} bytes`);
        } catch (error) {
            console.error('Gzip decompression failed:', error);
            throw new Error(`Failed to decompress gzip file: ${error.message}`);
        }
    }

    return buffer;
}

/**
 * Download a file from S3 (browser-compatible version)
 * Uses CORS proxy for anonymous access
 *
 * @param {string} s3_uri - S3 URI in format s3://bucket/key
 * @param {Object} storage_options - Storage options (e.g., {anon: true})
 * @returns {Promise<ArrayBuffer>} - Downloaded file as ArrayBuffer
 */
async function _download_from_s3(s3_uri, storage_options) {
    // Parse S3 URI
    const match = s3_uri.match(/^s3:\/\/([^\/]+)\/(.+)$/);
    if (!match) {
        throw new Error(`Invalid S3 URI: ${s3_uri}`);
    }

    const bucket = match[1];
    const key = match[2];

    // For anonymous access, use direct HTTPS URL with CORS proxy
    if (storage_options.anon) {
        const fileUrl = `https://s3.amazonaws.com/${bucket}/${key}`;
        console.log(`Downloading from public S3 URL: ${fileUrl}`);

        // Try multiple CORS proxies in sequence
        const proxyMethods = [
            {
                name: 'Iowa Hydroinformatics',
                url: `https://hydroinformatics.uiowa.edu/lab/cors/${encodeURIComponent(fileUrl)}`
            },
            {
                name: 'allorigins (raw)',
                url: `https://api.allorigins.win/raw?url=${encodeURIComponent(fileUrl)}`
            },
            {
                name: 'corsproxy.io',
                url: `https://corsproxy.io/?${encodeURIComponent(fileUrl)}`
            },
            {
                name: 'proxy.cors.sh',
                url: `https://proxy.cors.sh/${fileUrl}`
            },
            {
                name: 'direct (no proxy)',
                url: fileUrl
            }
        ];

        let lastError = null;

        for (const proxy of proxyMethods) {
            try {
                console.log(`Attempting download via ${proxy.name}...`);

                // Create timeout promise (30 seconds per proxy attempt)
                const timeout = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Request timeout')), 30000);
                });

                // Race between fetch and timeout
                const response = await Promise.race([
                    fetch(proxy.url, {
                        method: 'GET',
                        mode: 'cors'
                    }),
                    timeout
                ]);

                if (!response.ok) {
                    throw new Error(`${proxy.name} failed: ${response.status}`);
                }

                // Download with timeout
                const arrayBuffer = await Promise.race([
                    response.arrayBuffer(),
                    timeout
                ]);

                // Verify we got data
                if (arrayBuffer && arrayBuffer.byteLength > 0) {
                    console.log(`Successfully downloaded ${arrayBuffer.byteLength} bytes via ${proxy.name}`);
                    return arrayBuffer;
                }

                throw new Error('Downloaded file is empty');

            } catch (error) {
                lastError = error;
                console.warn(`${proxy.name} failed:`, error.message);
                continue;
            }
        }

        // If all proxies failed, throw the last error
        throw new Error(`All download methods failed. Last error: ${lastError?.message || 'Unknown error'}`);
    }

    // For authenticated access in browser, would need AWS SDK
    // This is not implemented in browser-only mode
    throw new Error('Authenticated S3 access not supported in browser-only mode. Use anonymous access (anon: true).');
}

export default { prepare_for_read };
