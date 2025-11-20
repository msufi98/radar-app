/**
 * Data Loading Module
 * Handles fetching radar data, site availability, and S3 interactions
 */

import { read_nexrad_archive } from '../nexrad_archive.js';

const S3_BASE_URL = 'https://s3.amazonaws.com/unidata-nexrad-level2';

const PROXY_METHODS = [
    {
        name: 'Iowa Hydroinformatics',
        getUrl: (s3Url) => `https://hydroinformatics.uiowa.edu/lab/cors/${encodeURIComponent(s3Url)}`
    },
    {
        name: 'allorigins',
        getUrl: (s3Url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(s3Url)}`
    },
    {
        name: 'corsproxy.io',
        getUrl: (s3Url) => `https://corsproxy.io/?${encodeURIComponent(s3Url)}`
    },
    {
        name: 'proxy.cors.sh',
        getUrl: (s3Url) => `https://proxy.cors.sh/${s3Url}`
    },
    {
        name: 'direct',
        getUrl: (s3Url) => s3Url
    }
];

/**
 * Fetch S3 data with multi-proxy fallback
 */
export async function fetchWithProxyFallback(s3Url) {
    let lastError = null;

    for (const proxy of PROXY_METHODS) {
        try {
            console.log(`Attempting fetch via ${proxy.name}...`);

            const timeout = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Request timeout')), 30000);
            });

            const response = await Promise.race([
                fetch(proxy.getUrl(s3Url), {
                    method: 'GET',
                    mode: 'cors'
                }),
                timeout
            ]);

            if (!response.ok) {
                throw new Error(`${proxy.name} returned status: ${response.status}`);
            }

            console.log(`Successfully fetched via ${proxy.name}`);
            return response;

        } catch (error) {
            lastError = error;
            console.warn(`${proxy.name} failed:`, error.message);
            continue;
        }
    }

    throw new Error(`All proxy methods failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Fetch available radar sites for a specific date
 */
export async function fetchAvailableSitesForDate(date) {
    const prefix = `${date}/`;
    const s3Url = `${S3_BASE_URL}?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=/`;

    try {
        console.log('Fetching available sites for:', date);

        const response = await fetchWithProxyFallback(s3Url);
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        const errorElement = xmlDoc.getElementsByTagName('Error')[0];
        if (errorElement) {
            console.log('No data for this date');
            return [];
        }

        const commonPrefixes = xmlDoc.getElementsByTagName('CommonPrefixes');
        const sites = [];

        for (let i = 0; i < commonPrefixes.length; i++) {
            const prefixElement = commonPrefixes[i].getElementsByTagName('Prefix')[0];
            if (prefixElement) {
                const prefix = prefixElement.textContent;
                const parts = prefix.split('/');
                const siteCode = parts[parts.length - 2];
                if (siteCode && siteCode.length === 4) {
                    sites.push(siteCode);
                }
            }
        }

        console.log(`Found ${sites.length} available sites for ${date}`);
        return sites;

    } catch (error) {
        console.error('Error fetching available sites:', error);
        throw error;
    }
}

/**
 * Check data availability for a specific site and date
 */
export async function checkDataAvailability(site, date) {
    const prefix = `${date}/${site.code}/`;
    const s3Url = `${S3_BASE_URL}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

    try {
        console.log('Checking data availability:', s3Url);

        const response = await fetchWithProxyFallback(s3Url);
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        const errorElement = xmlDoc.getElementsByTagName('Error')[0];
        if (errorElement) {
            const codeElement = errorElement.getElementsByTagName('Code')[0];
            if (codeElement && codeElement.textContent === 'NoSuchKey') {
                return { available: false, files: [] };
            }
        }

        const contents = xmlDoc.getElementsByTagName('Contents');
        const files = [];

        for (let i = 0; i < contents.length; i++) {
            const keyElement = contents[i].getElementsByTagName('Key')[0];
            if (keyElement) {
                const key = keyElement.textContent;
                const fileName = key.split('/').pop();
                if (fileName && fileName.startsWith(site.code)) {
                    files.push(fileName);
                }
            }
        }

        console.log(`Found ${files.length} files for ${site.code} on ${date}`);
        return { available: files.length > 0, files };

    } catch (error) {
        console.error('Error checking data availability:', error);
        throw error;
    }
}

/**
 * Extract times from filenames
 */
export function extractTimesFromFiles(files) {
    const times = [];
    let mdmCount = 0;
    let unmatchedFiles = [];

    const timeRegex = /[A-Z]{4}(\d{8})_(\d{6})(?:_V\d{2})?(?:\.\w+)?/;

    files.forEach(fileName => {
        if (fileName.includes('_MDM')) {
            mdmCount++;
            return;
        }

        const match = fileName.match(timeRegex);
        if (match) {
            const dateStr = match[1];
            const timeStr = match[2];

            const hour = timeStr.substring(0, 2);
            const minute = timeStr.substring(2, 4);
            const second = timeStr.substring(4, 6);

            times.push({
                fileName: fileName,
                display: `${hour}:${minute}:${second} UTC`,
                timestamp: dateStr + '_' + timeStr,
                hour: hour,
                minute: minute,
                second: second
            });
        } else {
            unmatchedFiles.push(fileName);
        }
    });

    console.log(`File processing: ${files.length} total, ${mdmCount} MDM skipped, ${times.length} times extracted`);
    if (unmatchedFiles.length > 0) {
        console.log(`Unmatched files: ${unmatchedFiles.length}`);
    }

    times.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    return times;
}

/**
 * Load radar data from S3
 */
export async function loadRadarData(site, date, fileName) {
    const s3Uri = `s3://unidata-nexrad-level2/${date}/${site.code}/${fileName}`;

    try {
        console.log('Loading radar file:', fileName);
        console.log('S3 URI:', s3Uri);

        const nexradFile = await read_nexrad_archive(s3Uri, {
            storage_options: { anon: true }
        });

        // Get scan info to determine range
        const scanInfo = nexradFile.scan_info([0])[0];
        const hasReflectivity = scanInfo.moments.includes('REF');

        let maxRange = 230000; // Default to 230km

        if (hasReflectivity) {
            const ranges = nexradFile.get_range(0, 'REF');
            if (ranges && ranges.length > 0) {
                maxRange = ranges[ranges.length - 1];
                console.log(`Reflectivity max range: ${(maxRange / 1000).toFixed(1)} km`);
            }
        }

        return {
            site,
            date,
            fileName,
            nexradFile,
            maxRange
        };

    } catch (error) {
        console.error('Error loading radar data:', error);
        throw error;
    }
}

/**
 * Filter scans by resolution
 */
export function filterScansByResolution(nexradFile, resolution) {
    const filteredScans = [];

    for (let i = 0; i < nexradFile.nscans; i++) {
        const scan = nexradFile.scans[i];
        const radialIndices = scan.indices;

        if (radialIndices.length > 0) {
            const firstRadial = nexradFile.radialRecords[radialIndices[0]];
            const elevAngle = firstRadial.msg_header.elevation_angle;
            const nrays = radialIndices.length;

            let includeScan = false;
            if (resolution === 'auto') {
                includeScan = true;
            } else if (resolution === '360' && nrays <= 400) {
                includeScan = true;
            } else if (resolution === '720' && nrays > 400) {
                includeScan = true;
            }

            if (includeScan) {
                filteredScans.push({
                    index: i,
                    elevAngle: elevAngle,
                    nrays: nrays
                });
            }
        }
    }

    filteredScans.sort((a, b) => a.elevAngle - b.elevAngle);
    return filteredScans;
}
