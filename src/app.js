import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import './styles.css';
import { NEXRAD_SITES } from './radar-sites.js';
import { read_nexrad_archive } from './nexrad_archive.js';

let map;
let markers = [];
let selectedSite = null;
let selectedDate = null;
let selectedTime = null;
let infoWindow;
let availableSites = null; // Store available sites for selected date
let rangeRings = []; // Store range ring circles for radar overlay
let crosshairLines = []; // Store crosshair lines for radar overlay
let radarOverlay = null; // Store radar heatmap overlay

// Initialize S3 client for public access
const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'anonymous',
        secretAccessKey: 'anonymous'
    },
    signer: { sign: async (request) => request }
});

/**
 * Fetch S3 data with multi-proxy fallback (similar to common.js pattern)
 * @param {string} s3Url - Direct S3 URL to fetch
 * @returns {Promise<Response>} - Fetch response
 */
async function fetchWithProxyFallback(s3Url) {
    // Try multiple CORS proxies in sequence
    const proxyMethods = [
        {
            name: 'Iowa Hydroinformatics',
            url: `https://hydroinformatics.uiowa.edu/lab/cors/${encodeURIComponent(s3Url)}`
        },
        {
            name: 'allorigins',
            url: `https://api.allorigins.win/raw?url=${encodeURIComponent(s3Url)}`
        },
        {
            name: 'corsproxy.io',
            url: `https://corsproxy.io/?${encodeURIComponent(s3Url)}`
        },
        {
            name: 'proxy.cors.sh',
            url: `https://proxy.cors.sh/${s3Url}`
        },
        {
            name: 'direct',
            url: s3Url
        }
    ];

    let lastError = null;

    for (const proxy of proxyMethods) {
        try {
            console.log(`Attempting fetch via ${proxy.name}...`);

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

    // If all proxies failed, throw the last error
    throw new Error(`All proxy methods failed. Last error: ${lastError?.message || 'Unknown error'}`);
}

async function initializeApp() {
    try {
        await google.maps.importLibrary("maps");
        await google.maps.importLibrary("marker");
        initMap();
        populateDateSelectors();
        setupResetButton();
    } catch (error) {
        console.error('Error loading Google Maps:', error);
        document.getElementById('map').innerHTML = `
            <div style="padding: 20px; text-align: center; color: #721c24;">
                <p>Failed to load Google Maps</p>
                <p>Please check your API key</p>
            </div>
        `;
    }
}

function initMap() {
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 4,
        center: { lat: 39.8283, lng: -98.5795 },
        mapTypeControl: false,
        streetViewControl: false,
        mapId: 'DEMO_MAP_ID'
    });

    infoWindow = new google.maps.InfoWindow();

    NEXRAD_SITES.forEach(site => {
        const marker = new google.maps.marker.AdvancedMarkerElement({
            map: map,
            position: { lat: site.lat, lng: site.lon },
            title: `${site.code} - ${site.name}, ${site.state}`,
            content: createMarkerContent(site)
        });

        marker.addListener('click', () => {
            selectSite(site, marker);
        });

        markers.push({ marker, site });
    });

    document.getElementById('siteSearch').addEventListener('input', filterSites);
}

function createMarkerContent(site) {
    const pin = document.createElement('div');
    pin.className = 'custom-marker';
    pin.style.backgroundColor = '#5a7a9e';
    pin.dataset.siteCode = site.code;
    return pin;
}

function selectSite(site, marker) {
    selectedSite = site;

    document.getElementById('selectedSite').innerHTML = `
        <strong>Selected:</strong> ${site.code} - ${site.name}, ${site.state}
    `;

    const content = `
        <div class="site-info-window">
            <h4>${site.code}</h4>
            <p>${site.name}, ${site.state}</p>
            <p>Lat: ${site.lat.toFixed(4)}, Lon: ${site.lon.toFixed(4)}</p>
        </div>
    `;

    infoWindow.setContent(content);
    infoWindow.open(map, marker);

    markers.forEach(({ marker: m, site: s }) => {
        if (m.content) {
            m.content.style.backgroundColor = s.code === site.code ? '#4a6a8e' : '#5a7a9e';
            m.content.style.transform = s.code === site.code ? 'scale(1.2)' : 'scale(1)';
        }
    });

    if (selectedDate) {
        checkDataAvailability();
    }
}

function filterSites(e) {
    // Use the new combined filter function
    filterMarkersBySiteAvailability();
}

function populateDateSelectors() {
    const yearSelect = document.getElementById('yearSelect');
    const currentYear = new Date().getFullYear();

    for (let year = currentYear; year >= 1991; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }

    yearSelect.addEventListener('change', async () => {
        const monthSelect = document.getElementById('monthSelect');
        monthSelect.disabled = !yearSelect.value;
        monthSelect.value = '';
        document.getElementById('daySelect').value = '';
        document.getElementById('daySelect').disabled = true;

        // Reset filter when year changes
        selectedDate = null;
        availableSites = null;
        filterMarkersBySiteAvailability();
        document.getElementById('dataStatus').innerHTML = '';

        if (yearSelect.value && selectedSite) {
            // Removed - only checking at the end now
            populateMonths();
        } else if (yearSelect.value) {
            populateMonths();
        }
    });

    document.getElementById('monthSelect').addEventListener('change', async () => {
        const daySelect = document.getElementById('daySelect');
        const monthSelect = document.getElementById('monthSelect');
        daySelect.disabled = !monthSelect.value;
        daySelect.value = '';

        // Reset filter when month changes
        selectedDate = null;
        availableSites = null;
        filterMarkersBySiteAvailability();
        document.getElementById('dataStatus').innerHTML = '';

        if (monthSelect.value && selectedSite && yearSelect.value) {
            // Removed - only checking at the end now
            populateDays();
        } else if (monthSelect.value) {
            populateDays();
        }
    });

    document.getElementById('daySelect').addEventListener('change', () => {
        if (document.getElementById('daySelect').value) {
            updateSelectedDate();
        }
    });
}

function populateMonths() {
    const monthSelect = document.getElementById('monthSelect');
    const months = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    monthSelect.innerHTML = '<option value="">Select Month</option>';

    months.forEach((month, index) => {
        const option = document.createElement('option');
        option.value = String(index + 1).padStart(2, '0');
        option.textContent = month;
        monthSelect.appendChild(option);
    });
}

function populateDays() {
    const year = parseInt(document.getElementById('yearSelect').value);
    const month = parseInt(document.getElementById('monthSelect').value);
    const daySelect = document.getElementById('daySelect');

    const daysInMonth = new Date(year, month, 0).getDate();

    daySelect.innerHTML = '<option value="">Select Day</option>';

    for (let day = 1; day <= daysInMonth; day++) {
        const option = document.createElement('option');
        option.value = String(day).padStart(2, '0');
        option.textContent = day;
        daySelect.appendChild(option);
    }
}

// Removed checkYearAvailability and checkMonthAvailability - only checking at the end now
// Continuation of removed functions

async function updateSelectedDate() {
    const year = document.getElementById('yearSelect').value;
    const month = document.getElementById('monthSelect').value;
    const day = document.getElementById('daySelect').value;

    if (year && month && day) {
        selectedDate = `${year}/${month}/${day}`;

        // Fetch available sites for this date
        await fetchAvailableSitesForDate();

        if (selectedSite) {
            checkDataAvailability();
        }
    }
}

async function fetchAvailableSitesForDate() {
    if (!selectedDate) return;

    const statusDiv = document.getElementById('dataStatus');
    statusDiv.className = 'status-message loading';
    statusDiv.innerHTML = '<span class="spinner"></span> Fetching available radar sites for selected date...';

    const s3BaseUrl = 'https://s3.amazonaws.com/unidata-nexrad-level2';
    const prefix = `${selectedDate}/`;
    const s3Url = `${s3BaseUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}&delimiter=/`;

    try {
        console.log('Fetching available sites for:', selectedDate);

        // Use multi-proxy fallback
        const response = await fetchWithProxyFallback(s3Url);
        const text = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Check for error
        const errorElement = xmlDoc.getElementsByTagName('Error')[0];
        if (errorElement) {
            console.log('No data for this date');
            availableSites = [];
            filterMarkersBySiteAvailability();
            statusDiv.className = 'status-message warning';
            statusDiv.textContent = 'No radar data available for selected date';
            return;
        }

        // Get common prefixes (subdirectories = radar sites)
        const commonPrefixes = xmlDoc.getElementsByTagName('CommonPrefixes');
        const sites = [];

        for (let i = 0; i < commonPrefixes.length; i++) {
            const prefixElement = commonPrefixes[i].getElementsByTagName('Prefix')[0];
            if (prefixElement) {
                const prefix = prefixElement.textContent;
                // Extract site code from prefix like "2013/05/06/KABR/"
                const parts = prefix.split('/');
                const siteCode = parts[parts.length - 2];
                if (siteCode && siteCode.length === 4) {
                    sites.push(siteCode);
                }
            }
        }

        console.log(`Found ${sites.length} available sites for ${selectedDate}:`, sites);
        availableSites = sites;
        filterMarkersBySiteAvailability();

        statusDiv.className = 'status-message success';
        statusDiv.innerHTML = `<span class="checkmark">✓</span> ${sites.length} radar sites available for selected date. Click on a site marker to load data.`;

    } catch (error) {
        console.error('Error fetching available sites:', error);
        statusDiv.className = 'status-message warning';
        statusDiv.innerHTML = `Unable to fetch available sites. All sites shown.<br><small>${error.message}</small>`;
        availableSites = null; // Show all sites on error
        filterMarkersBySiteAvailability();
    }
}

function filterMarkersBySiteAvailability() {
    const searchTerm = document.getElementById('siteSearch').value.toLowerCase();

    markers.forEach(({ marker, site }) => {
        // Check if site matches search term
        const matchesSearch = site.code.toLowerCase().includes(searchTerm) ||
                             site.name.toLowerCase().includes(searchTerm) ||
                             site.state.toLowerCase().includes(searchTerm);

        // Check if site is available for selected date
        const isAvailable = availableSites === null || availableSites.includes(site.code);

        // Show marker only if it matches search (keep unavailable sites visible but grayed)
        marker.map = matchesSearch ? map : null;

        // Update marker appearance based on availability
        if (marker.content) {
            if (!isAvailable) {
                // Gray out unavailable sites
                marker.content.style.backgroundColor = '#cbd5e0';
                marker.content.style.opacity = '1';
                marker.content.style.transform = 'scale(1)';
            } else if (site.code === selectedSite?.code) {
                // Highlight selected site
                marker.content.style.backgroundColor = '#4a6a8e';
                marker.content.style.transform = 'scale(1.2)';
                marker.content.style.opacity = '1';
            } else {
                // Normal available site
                marker.content.style.backgroundColor = '#5a7a9e';
                marker.content.style.transform = 'scale(1)';
                marker.content.style.opacity = '1';
            }
        }
    });
}

async function checkDataAvailability() {
    if (!selectedSite || !selectedDate) return;

    const statusDiv = document.getElementById('dataStatus');
    statusDiv.className = 'status-message loading';
    statusDiv.innerHTML = '<span class="spinner"></span> Checking data availability...';

    // Use the public S3 endpoint with correct format
    // Using the correct bucket: unidata-nexrad-level2
    const s3BaseUrl = 'https://s3.amazonaws.com/unidata-nexrad-level2';
    const prefix = `${selectedDate}/${selectedSite.code}/`;
    const s3Url = `${s3BaseUrl}?list-type=2&prefix=${encodeURIComponent(prefix)}`;

    console.log('S3 URL:', s3Url);

    try {
        console.log('Fetching data availability via multi-proxy fallback...');

        // Use multi-proxy fallback
        const response = await fetchWithProxyFallback(s3Url);
        const text = await response.text();
        console.log('Response text:', text);

        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, 'text/xml');

        // Check for error response
        const errorElement = xmlDoc.getElementsByTagName('Error')[0];
        if (errorElement) {
            const codeElement = errorElement.getElementsByTagName('Code')[0];
            const messageElement = errorElement.getElementsByTagName('Message')[0];
            console.log('S3 Error:', codeElement?.textContent, messageElement?.textContent);

            if (codeElement && codeElement.textContent === 'NoSuchKey') {
                statusDiv.className = 'status-message error';
                statusDiv.textContent = `No data available for ${selectedSite.code} on ${selectedDate}`;
                document.getElementById('timeSelector').style.display = 'none';
                return;
            }
        }

        const contents = xmlDoc.getElementsByTagName('Contents');
        console.log('Number of Contents elements:', contents.length);

        if (contents.length > 0) {
            const files = [];
            console.log('Processing contents...');

            // Log first few for debugging
            for (let i = 0; i < Math.min(5, contents.length); i++) {
                const keyElement = contents[i].getElementsByTagName('Key')[0];
                if (keyElement) {
                    console.log(`Key ${i}:`, keyElement.textContent);
                }
            }

            // Process all files
            for (let i = 0; i < contents.length; i++) {
                const keyElement = contents[i].getElementsByTagName('Key')[0];
                if (keyElement) {
                    const key = keyElement.textContent;
                    const fileName = key.split('/').pop();
                    if (fileName && fileName.startsWith(selectedSite.code)) {
                        files.push(fileName);
                    }
                }
            }
            console.log('Extracted files:', files.length, 'files');

            if (files.length > 0) {
                statusDiv.className = 'status-message success';
                statusDiv.innerHTML = `<span class="checkmark">✓</span> Data available: ${files.length} files found`;
                displayAvailableTimes(files);
            } else {
                statusDiv.className = 'status-message error';
                statusDiv.innerHTML = `<span class="error-icon">✗</span> No data available for ${selectedSite.code} on ${selectedDate}`;
                document.getElementById('timeSelector').style.display = 'none';
            }
        } else {
            // No data for this date
            statusDiv.className = 'status-message error';
            statusDiv.innerHTML = `<span class="error-icon">✗</span> No data available for ${selectedSite.code} on ${selectedDate}`;
            document.getElementById('timeSelector').style.display = 'none';
        }

    } catch (error) {
        console.error('Proxy fallback failed:', error);

        // If proxy fails, show error with sample data
        statusDiv.className = 'status-message warning';
        statusDiv.innerHTML = `
            <strong>Unable to fetch live data.</strong><br>
            Error: ${error.message}<br>
            Using sample data for demonstration.<br>
            <br>You can also try AWS CLI:
            <br><code style="display: block; background: #f4f4f4; padding: 10px; margin: 10px 0; border-radius: 4px; font-family: monospace;">aws s3 ls s3://unidata-nexrad-level2/${selectedDate}/${selectedSite.code}/ --no-sign-request</code>
        `;

        // Show sample times for demonstration
        const sampleFiles = [
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_000000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_003000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_010000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_013000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_020000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_023000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_030000_V06`,
            `${selectedSite.code}_${selectedDate.replace(/\//g, '')}_033000_V06`,
        ];
        displayAvailableTimes(sampleFiles);
    }
}

function displayAvailableTimes(files) {
    const timeSelector = document.getElementById('timeSelector');
    const timesList = document.getElementById('timesList');

    timeSelector.style.display = 'block';
    timesList.innerHTML = '';

    const times = extractTimesFromFiles(files);

    console.log(`Displaying ${times.length} available scan times from ${files.length} files`);

    // Update the heading to show count
    const heading = timeSelector.querySelector('.time-selector__heading');
    if (heading) {
        heading.textContent = `Available Times (${times.length} scans - Click to Load)`;
    }

    times.forEach(time => {
        const timeItem = document.createElement('div');
        timeItem.className = 'time-item';
        timeItem.textContent = time.display;
        timeItem.dataset.fileName = time.fileName;

        timeItem.addEventListener('click', async () => {
            // Highlight selected time
            document.querySelectorAll('.time-item').forEach(item => {
                item.classList.remove('selected');
            });
            timeItem.classList.add('selected');

            // Set selected time and load radar data
            selectedTime = time.fileName;
            await loadRadarData();
        });

        timesList.appendChild(timeItem);
    });
}

function extractTimesFromFiles(files) {
    const times = [];
    let mdmCount = 0;
    let unmatchedFiles = [];

    // Updated regex to match NEXRAD file formats:
    // Modern: KABR20171010_000541_V06
    // Older: KIWX19990612_000448.gz or KIWX19990612_000448
    const timeRegex = /[A-Z]{4}(\d{8})_(\d{6})(?:_V\d{2})?(?:\.\w+)?/;

    files.forEach(fileName => {
        // Skip MDM files (metadata files)
        if (fileName.includes('_MDM')) {
            mdmCount++;
            return;
        }

        const match = fileName.match(timeRegex);
        if (match) {
            const dateStr = match[1]; // 20171010
            const timeStr = match[2]; // 000541

            const year = dateStr.substring(0, 4);
            const month = dateStr.substring(4, 6);
            const day = dateStr.substring(6, 8);

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

    console.log(`File processing summary:`);
    console.log(`- Total files: ${files.length}`);
    console.log(`- MDM files skipped: ${mdmCount}`);
    console.log(`- Times extracted: ${times.length}`);
    if (unmatchedFiles.length > 0) {
        console.log(`- Unmatched files: ${unmatchedFiles.length}`);
        console.log(`  Sample unmatched:`, unmatchedFiles.slice(0, 3));
    }

    // Sort by timestamp
    times.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    return times;
}

/**
 * Map a value to rainbow color (violet to red)
 * @param {number} value - Normalized value between 0 and 1
 * @returns {string} - RGB color string
 */
function valueToRainbowColor(value) {
    // Clamp value between 0 and 1
    value = Math.max(0, Math.min(1, value));

    // Map value to hue: 270° (violet) to 0° (red)
    // We reverse it so 0 = violet, 1 = red
    const hue = (1 - value) * 270;

    // Convert HSL to RGB
    const h = hue / 360;
    const s = 1.0; // Full saturation
    const l = 0.5; // Medium lightness

    let r, g, b;

    if (s === 0) {
        r = g = b = l;
    } else {
        const hue2rgb = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1/6) return p + (q - p) * 6 * t;
            if (t < 1/2) return q;
            if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
            return p;
        };

        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;

        r = hue2rgb(p, q, h + 1/3);
        g = hue2rgb(p, q, h);
        b = hue2rgb(p, q, h - 1/3);
    }

    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
}

/**
 * Calculate a point at a given distance and bearing from a center point
 * @param {Object} center - {lat, lng} starting point
 * @param {number} distance - Distance in meters
 * @param {number} bearing - Bearing in degrees (0 = North, 90 = East)
 * @returns {Object} - {lat, lng} destination point
 */
function calculateDestinationPoint(center, distance, bearing) {
    const R = 6371000; // Earth's radius in meters
    const lat1 = center.lat * Math.PI / 180;
    const lng1 = center.lng * Math.PI / 180;
    const bearingRad = bearing * Math.PI / 180;

    const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(distance / R) +
        Math.cos(lat1) * Math.sin(distance / R) * Math.cos(bearingRad)
    );

    const lng2 = lng1 + Math.atan2(
        Math.sin(bearingRad) * Math.sin(distance / R) * Math.cos(lat1),
        Math.cos(distance / R) - Math.sin(lat1) * Math.sin(lat2)
    );

    return {
        lat: lat2 * 180 / Math.PI,
        lng: lng2 * 180 / Math.PI
    };
}

/**
 * Create crosshair (plus sign) overlay on the map
 * @param {Object} center - {lat, lng} center point
 * @param {number} maxRange - Maximum range in meters (radius of largest circle)
 */
function createCrosshair(center, maxRange) {
    // Clear existing crosshair lines
    crosshairLines.forEach(line => line.setMap(null));
    crosshairLines = [];

    // Convert maxRange to approximate degrees
    // At equator: 1 degree latitude ≈ 111km
    // Longitude varies by latitude: 1 degree ≈ 111km * cos(lat)
    const latOffset = (maxRange / 1000) / 111; // Convert meters to degrees
    const lngOffset = (maxRange / 1000) / (111 * Math.cos(center.lat * Math.PI / 180));

    // Create horizontal line (constant latitude, varying longitude)
    const horizontalLine = new google.maps.Polyline({
        path: [
            { lat: center.lat, lng: center.lng - lngOffset },
            { lat: center.lat, lng: center.lng + lngOffset }
        ],
        strokeColor: '#666666',
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        geodesic: false,
        map: map,
        clickable: false,
        zIndex: 2
    });

    // Create vertical line (constant longitude, varying latitude)
    const verticalLine = new google.maps.Polyline({
        path: [
            { lat: center.lat - latOffset, lng: center.lng },
            { lat: center.lat + latOffset, lng: center.lng }
        ],
        strokeColor: '#666666',
        strokeOpacity: 0.6,
        strokeWeight: 1.5,
        geodesic: false,
        map: map,
        clickable: false,
        zIndex: 2
    });

    crosshairLines.push(verticalLine, horizontalLine);
    console.log(`Created crosshair overlay centered at (${center.lat.toFixed(4)}, ${center.lng.toFixed(4)})`);
}

/**
 * Create range ring circles (bullseye overlay) on the map
 * @param {Object} center - {lat, lng} center point for the rings
 * @param {number} maxRange - Maximum range in meters
 * @param {number} numRings - Number of range rings to create
 */
function createRangeRings(center, maxRange, numRings = 5) {
    // Clear existing range rings
    rangeRings.forEach(ring => ring.setMap(null));
    rangeRings = [];

    // Calculate evenly spaced ranges
    const ranges = [];
    const interval = maxRange / numRings;
    for (let i = 1; i <= numRings; i++) {
        ranges.push(interval * i);
    }

    console.log(`Creating ${numRings} range rings, max range: ${(maxRange / 1000).toFixed(1)} km`);
    console.log('Ring distances:', ranges.map(r => `${(r / 1000).toFixed(1)}km`).join(', '));

    // Create concentric circles
    ranges.forEach((radius, index) => {
        const circle = new google.maps.Circle({
            strokeColor: '#666666',
            strokeOpacity: 0.6,
            strokeWeight: 1.5,
            fillColor: 'transparent',
            fillOpacity: 0,
            map: map,
            center: center,
            radius: radius, // in meters
            clickable: false,
            zIndex: 1
        });

        rangeRings.push(circle);
    });
}

async function loadRadarData() {
    const radarStatusDiv = document.getElementById('radarStatus');

    // Immediately switch to Step 2 to show loading progress
    const step1Header = document.getElementById('step1Header');
    const step1Content = document.getElementById('step1Content');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');

    // Collapse Step 1
    step1Header.setAttribute('aria-expanded', 'false');
    step1Content.style.display = 'none';
    step1Header.querySelector('.accordion-header__icon').textContent = '▼';

    // Expand Step 2
    step2Header.setAttribute('aria-expanded', 'true');
    step2Content.style.display = 'block';
    step2Header.querySelector('.accordion-header__icon').textContent = '▲';

    // Show loading progress in radar status (Step 2)
    radarStatusDiv.className = 'status-message loading';
    radarStatusDiv.innerHTML = '<span class="spinner"></span> Loading radar data...';

    // Clear all markers from the map
    markers.forEach(({ marker }) => {
        marker.map = null;
    });

    // Zoom map to radar location
    const radarCenter = { lat: selectedSite.lat, lng: selectedSite.lon };
    map.setCenter(radarCenter);
    map.setZoom(8);

    // Construct the S3 URI for the file
    const s3Uri = `s3://unidata-nexrad-level2/${selectedDate}/${selectedSite.code}/${selectedTime}`;

    try {
        console.log('Loading radar file:', selectedTime);
        console.log('S3 URI:', s3Uri);

        // Call read_nexrad_archive to load and parse the data
        const nexradFile = await read_nexrad_archive(s3Uri, {
            storage_options: { anon: true }
        });

        // Get the first scan info to determine range parameters
        const scanInfo = nexradFile.scan_info([0])[0];
        const hasReflectivity = scanInfo.moments.includes('REF');

        let maxRange = 230000; // Default to 230km

        if (hasReflectivity) {
            // Get actual range data from reflectivity
            const ranges = nexradFile.get_range(0, 'REF');
            if (ranges && ranges.length > 0) {
                maxRange = ranges[ranges.length - 1]; // Last range value
                console.log(`Reflectivity max range: ${(maxRange / 1000).toFixed(1)} km`);
            }
        }

        // Create range rings based on actual data range
        createRangeRings(radarCenter, maxRange, 5);

        // Create crosshair (plus sign) inscribed in largest circle
        createCrosshair(radarCenter, maxRange);

        // Format time from selectedTime (e.g., "KAMX20241110_235959_V06" -> "23:59:59")
        const timeMatch = selectedTime.match(/_(\d{6})_/);
        const timeStr = timeMatch ?
            `${timeMatch[1].substring(0, 2)}:${timeMatch[1].substring(2, 4)}:${timeMatch[1].substring(4, 6)} UTC` :
            selectedTime;

        // Display parsed information in radar status (Step 2)
        radarStatusDiv.className = 'status-message success';
        radarStatusDiv.innerHTML = `
            <span class="checkmark">✓</span> Radar data downloaded successfully!<br>
            <strong>Site:</strong> ${nexradFile.volumeHeader.icao.trim()}<br>
            <strong>Date:</strong> ${selectedDate}<br>
            <strong>Time:</strong> ${timeStr}<br>
            <strong>VCP:</strong> ${nexradFile.getVCPPattern()}<br>
            <strong>Scans:</strong> ${nexradFile.nscans}<br>
            <strong>Radials:</strong> ${nexradFile.radialRecords.length}<br>
            <strong>Max Range:</strong> ${(maxRange / 1000).toFixed(1)} km
        `;

        // Store the parsed data for the viewer
        window.radarFileData = {
            site: selectedSite,
            date: selectedDate,
            fileName: selectedTime,
            nexradFile: nexradFile,
            maxRange: maxRange
        };

        console.log('Radar data ready for viewer');

        // Switch to radar display controls
        showRadarControls(nexradFile);

    } catch (error) {
        console.error('Error loading radar data:', error);
        radarStatusDiv.className = 'status-message error';
        radarStatusDiv.innerHTML = `
            <span class="error-icon">✗</span> Failed to load radar data<br>
            <small>${error.message}</small>
        `;
    }
}

/**
 * Show radar display controls and hide date/time selection
 */
function showRadarControls(nexradFile) {
    // Note: Step 1/Step 2 accordion switching is now handled at the start of loadRadarData()
    // to provide immediate visual feedback

    // Store radar file globally for resolution filtering
    window.currentRadarFile = nexradFile;

    // Reset resolution and scan level selectors
    const resolutionSelect = document.getElementById('resolutionSelect');
    const scanLevelSelect = document.getElementById('scanLevelSelect');

    resolutionSelect.value = '';
    scanLevelSelect.innerHTML = '<option value="">Select Resolution First</option>';
    scanLevelSelect.disabled = true;

    console.log(`Radar data loaded with ${nexradFile.nscans} scan levels`);
}

/**
 * Filter and populate scan levels based on selected resolution
 * @param {string} resolution - Resolution filter ('auto', '360', '720', or '')
 */
function filterScanLevelsByResolution(resolution) {
    const nexradFile = window.currentRadarFile;
    if (!nexradFile) return;

    const scanLevelSelect = document.getElementById('scanLevelSelect');
    scanLevelSelect.innerHTML = '<option value="">Select Scan</option>';

    if (!resolution) {
        scanLevelSelect.disabled = true;
        scanLevelSelect.innerHTML = '<option value="">Select Resolution First</option>';
        return;
    }

    let filteredScans = [];

    for (let i = 0; i < nexradFile.nscans; i++) {
        const scan = nexradFile.scans[i];
        const radialIndices = scan.indices;

        if (radialIndices.length > 0) {
            const firstRadial = nexradFile.radialRecords[radialIndices[0]];
            const elevAngle = firstRadial.msg_header.elevation_angle;
            const nrays = radialIndices.length;

            // Filter based on resolution
            let includeScna = false;
            if (resolution === 'auto') {
                includeScna = true;
            } else if (resolution === '360' && nrays <= 400) {
                includeScna = true; // Low resolution: ~360 rays
            } else if (resolution === '720' && nrays > 400) {
                includeScna = true; // High resolution: ~720 rays
            }

            if (includeScna) {
                filteredScans.push({
                    index: i,
                    elevAngle: elevAngle,
                    nrays: nrays
                });
            }
        }
    }

    // Sort scans by elevation angle in ascending order
    filteredScans.sort((a, b) => a.elevAngle - b.elevAngle);

    // Populate dropdown with filtered scans
    filteredScans.forEach(scan => {
        const option = document.createElement('option');
        option.value = scan.index;
        option.textContent = `Scan ${scan.index + 1}: ${scan.elevAngle.toFixed(2)}° (${scan.nrays} radials)`;
        scanLevelSelect.appendChild(option);
    });

    // Enable dropdown (don't auto-select, wait for user to choose)
    scanLevelSelect.disabled = false;

    console.log(`Filtered to ${filteredScans.length} scans for resolution: ${resolution}`);
}

/**
 * Hide radar controls and show date/time selection
 */
function hideRadarControls() {
    // Expand Step 1, collapse Step 2
    const step1Header = document.getElementById('step1Header');
    const step1Content = document.getElementById('step1Content');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');

    // Expand Step 1
    step1Header.setAttribute('aria-expanded', 'true');
    step1Content.style.display = 'block';
    step1Header.querySelector('.accordion-header__icon').textContent = '▲'; // Up when expanded

    // Collapse Step 2
    step2Header.setAttribute('aria-expanded', 'false');
    step2Content.style.display = 'none';
    step2Header.querySelector('.accordion-header__icon').textContent = '▼'; // Down when collapsed

    // Hide legend
    hideLegend();

    // Clear range rings and crosshair
    rangeRings.forEach(ring => ring.setMap(null));
    rangeRings = [];
    crosshairLines.forEach(line => line.setMap(null));
    crosshairLines = [];

    // Clear radar overlay
    if (radarOverlay) {
        radarOverlay.setMap(null);
        radarOverlay = null;
    }

    // Restore markers
    filterMarkersBySiteAvailability();

    // Reset zoom
    map.setCenter({ lat: 39.8283, lng: -98.5795 });
    map.setZoom(4);
}

function setupResetButton() {
    const resetBtn = document.getElementById('resetBtn');
    if (resetBtn) {
        resetBtn.addEventListener('click', resetFilters);
    }
}

function resetFilters() {
    console.log('Resetting filters and selections');

    // Clear search input
    const searchInput = document.getElementById('siteSearch');
    if (searchInput) {
        searchInput.value = '';
    }

    // Clear selected site
    selectedSite = null;
    const selectedSiteDiv = document.getElementById('selectedSite');
    if (selectedSiteDiv) {
        selectedSiteDiv.innerHTML = '';
    }

    // Reset date selectors
    document.getElementById('yearSelect').value = '';
    document.getElementById('monthSelect').value = '';
    document.getElementById('monthSelect').disabled = true;
    document.getElementById('daySelect').value = '';
    document.getElementById('daySelect').disabled = true;

    // Clear selected date and time
    selectedDate = null;
    selectedTime = null;
    availableSites = null;

    // Clear status messages
    const statusDiv = document.getElementById('dataStatus');
    if (statusDiv) {
        statusDiv.className = 'status-message';
        statusDiv.innerHTML = '';
    }
    const radarStatusDiv = document.getElementById('radarStatus');
    if (radarStatusDiv) {
        radarStatusDiv.className = 'status-message';
        radarStatusDiv.innerHTML = '';
    }

    // Hide and clear time selector
    const timeSelector = document.getElementById('timeSelector');
    if (timeSelector) {
        timeSelector.style.display = 'none';
    }
    const timesList = document.getElementById('timesList');
    if (timesList) {
        timesList.innerHTML = '';
    }

    // Expand Step 1, collapse Step 2 (accordion management)
    const step1Header = document.getElementById('step1Header');
    const step1Content = document.getElementById('step1Content');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');

    if (step1Header && step1Content) {
        step1Header.setAttribute('aria-expanded', 'true');
        step1Content.style.display = 'block';
        step1Header.querySelector('.accordion-header__icon').textContent = '▲'; // Up when expanded
    }

    if (step2Header && step2Content) {
        step2Header.setAttribute('aria-expanded', 'false');
        step2Content.style.display = 'none';
        step2Header.querySelector('.accordion-header__icon').textContent = '▼'; // Down when collapsed
    }

    // Hide legend
    hideLegend();

    // Clear range rings and crosshair
    rangeRings.forEach(ring => ring.setMap(null));
    rangeRings = [];
    crosshairLines.forEach(line => line.setMap(null));
    crosshairLines = [];

    // Clear radar overlay
    if (radarOverlay) {
        radarOverlay.setMap(null);
        radarOverlay = null;
    }

    // Reset all markers to default state
    filterMarkersBySiteAvailability();

    // Reset zoom to full US view
    map.setCenter({ lat: 39.8283, lng: -98.5795 });
    map.setZoom(4);

    // Close any open info windows
    if (infoWindow) {
        infoWindow.close();
    }

    console.log('Filters and selections reset');
}

/**
 * Generate and display radar heatmap overlay
 * @param {number} scanIndex - Scan index to display
 * @param {string} resolution - Resolution mode ('auto', '360', '720')
 */
async function displayRadarHeatmap(scanIndex, resolution) {
    const radarData = window.radarFileData;
    if (!radarData) {
        console.error('No radar data available');
        return;
    }

    const nexradFile = radarData.nexradFile;
    const center = { lat: radarData.site.lat, lng: radarData.site.lon };
    const radarStatusDiv = document.getElementById('radarStatus');

    console.log(`Generating heatmap for scan ${scanIndex}, resolution: ${resolution}`);

    // Show generating message
    radarStatusDiv.className = 'status-message loading';
    radarStatusDiv.innerHTML = '<span class="spinner"></span> Generating heatmap...';

    // Get scan info
    const scanInfo = nexradFile.scan_info([scanIndex])[0];
    if (!scanInfo.moments.includes('REF')) {
        radarStatusDiv.className = 'status-message error';
        radarStatusDiv.innerHTML = '<span class="error-icon">✗</span> No reflectivity data available for this scan';
        return;
    }

    // Get data arrays
    const ngates = scanInfo.ngates.REF;
    const nrays = scanInfo.nrays;
    const azimuths = nexradFile.get_azimuth_angles([scanIndex]);
    const ranges = nexradFile.get_range(scanIndex, 'REF');
    const refData = nexradFile.get_data('REF', ngates, [scanIndex], false);

    console.log(`Data dimensions: ${nrays} rays × ${ngates} gates`);

    // Find min/max values for color scaling (ignore null values)
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let ray = 0; ray < nrays; ray++) {
        for (let gate = 0; gate < ngates; gate++) {
            const val = refData[ray][gate];
            if (val !== null && val !== undefined && !isNaN(val)) {
                minVal = Math.min(minVal, val);
                maxVal = Math.max(maxVal, val);
            }
        }
    }

    console.log(`Reflectivity range: ${minVal.toFixed(1)} to ${maxVal.toFixed(1)} dBZ`);

    // Create canvas for rendering
    const canvasSize = 2048; // High resolution canvas
    const canvas = document.createElement('canvas');
    canvas.width = canvasSize;
    canvas.height = canvasSize;
    const ctx = canvas.getContext('2d');

    // Clear canvas
    ctx.clearRect(0, 0, canvasSize, canvasSize);

    // Calculate pixels per meter for scaling
    const maxRange = ranges[ranges.length - 1];
    const scale = (canvasSize / 2) / maxRange;

    // Draw each radial
    for (let ray = 0; ray < nrays; ray++) {
        const azimuth = azimuths[ray];
        const azimuthRad = (azimuth - 90) * Math.PI / 180; // Convert to math coordinates (0° = East)

        for (let gate = 0; gate < ngates; gate++) {
            const val = refData[ray][gate];

            // Skip null/invalid values
            if (val === null || val === undefined || isNaN(val)) {
                continue;
            }

            // Normalize value for color mapping
            const normalized = (val - minVal) / (maxVal - minVal);
            const color = valueToRainbowColor(normalized);

            // Calculate position on canvas
            const range = ranges[gate];
            const x = canvasSize / 2 + range * Math.cos(azimuthRad) * scale;
            const y = canvasSize / 2 + range * Math.sin(azimuthRad) * scale;

            // Calculate gate dimensions for proper coverage
            const nextRange = gate < ngates - 1 ? ranges[gate + 1] : range + (range - (gate > 0 ? ranges[gate - 1] : 0));
            const gateWidth = (nextRange - range) * scale;
            const azimuthSpacing = 360 / nrays;
            const azimuthWidthRad = azimuthSpacing * Math.PI / 180;

            // Draw as a wedge segment
            ctx.fillStyle = color;
            ctx.globalAlpha = 0.7; // Semi-transparent

            // Draw rectangle approximation (faster than wedge)
            const size = Math.max(gateWidth, 2);
            ctx.fillRect(x - size / 2, y - size / 2, size, size);
        }
    }

    // Reset alpha
    ctx.globalAlpha = 1.0;

    // Convert canvas to image URL
    const imageUrl = canvas.toDataURL('image/png');

    // Calculate geographic bounds
    const maxRangeMeters = maxRange;
    const north = calculateDestinationPoint(center, maxRangeMeters, 0);
    const south = calculateDestinationPoint(center, maxRangeMeters, 180);
    const east = calculateDestinationPoint(center, maxRangeMeters, 90);
    const west = calculateDestinationPoint(center, maxRangeMeters, 270);

    const bounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(south.lat, west.lng),
        new google.maps.LatLng(north.lat, east.lng)
    );

    // Remove existing overlay
    if (radarOverlay) {
        radarOverlay.setMap(null);
    }

    // Create ground overlay
    radarOverlay = new google.maps.GroundOverlay(imageUrl, bounds, {
        opacity: 0.7,
        clickable: false
    });

    radarOverlay.setMap(map);

    console.log('Heatmap overlay created successfully');

    // Get elevation angle for this scan
    const firstRadial = nexradFile.radialRecords[nexradFile.scans[scanIndex].indices[0]];
    const elevAngle = firstRadial.msg_header.elevation_angle;

    // Format time from radarData
    const timeMatch = radarData.fileName.match(/_(\d{6})_/);
    const timeStr = timeMatch ?
        `${timeMatch[1].substring(0, 2)}:${timeMatch[1].substring(2, 4)}:${timeMatch[1].substring(4, 6)} UTC` :
        radarData.fileName;

    // Update status with scan information
    radarStatusDiv.className = 'status-message success';
    radarStatusDiv.innerHTML = `
        <span class="checkmark">✓</span> Heatmap displayed successfully!<br>
        <strong>Site:</strong> ${radarData.site.code}<br>
        <strong>Date:</strong> ${radarData.date}<br>
        <strong>Time:</strong> ${timeStr}<br>
        <strong>Elevation:</strong> ${elevAngle.toFixed(2)}°<br>
        <strong>Radials:</strong> ${nrays}<br>
        <strong>Gates:</strong> ${ngates}<br>
        <strong>Reflectivity:</strong> ${minVal.toFixed(1)} to ${maxVal.toFixed(1)} dBZ
    `;

    // Show and update the legend
    updateLegend(minVal, maxVal);
}

/**
 * Update the reflectivity legend with a continuous color ramp
 * @param {number} minVal - Minimum reflectivity value in dBZ
 * @param {number} maxVal - Maximum reflectivity value in dBZ
 */
function updateLegend(minVal, maxVal) {
    const legendElement = document.getElementById('reflectivityLegend');
    const canvas = document.getElementById('legendCanvas');
    const ticksSvg = document.getElementById('legendTicks');
    const minLabel = document.getElementById('legendMin');
    const midLabel = document.getElementById('legendMid');
    const maxLabel = document.getElementById('legendMax');

    // Show the legend
    legendElement.style.display = 'block';

    // Calculate midpoint
    const midVal = (minVal + maxVal) / 2;

    // Update labels
    minLabel.textContent = minVal.toFixed(0);
    midLabel.textContent = midVal.toFixed(0);
    maxLabel.textContent = maxVal.toFixed(0);

    // Set canvas size (use high DPI for crisp rendering)
    const dpr = window.devicePixelRatio || 1;
    const width = 200;
    const height = 20;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';

    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Draw continuous color gradient
    for (let x = 0; x < width; x++) {
        const normalizedValue = x / (width - 1);
        const color = valueToRainbowColor(normalizedValue);

        ctx.fillStyle = color;
        ctx.fillRect(x, 0, 1, height);
    }

    // Draw tick marks using SVG
    ticksSvg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    ticksSvg.innerHTML = '';

    const tickPositions = [
        { x: 0, label: 'min' },
        { x: width / 2, label: 'mid' },
        { x: width, label: 'max' }
    ];

    tickPositions.forEach(tick => {
        // Create tick line
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', tick.x);
        line.setAttribute('y1', height);
        line.setAttribute('x2', tick.x);
        line.setAttribute('y2', height + 6);
        line.setAttribute('stroke', '#718096');
        line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round');
        ticksSvg.appendChild(line);
    });
}

/**
 * Hide the reflectivity legend
 */
function hideLegend() {
    const legendElement = document.getElementById('reflectivityLegend');
    legendElement.style.display = 'none';
}

// Setup radar control event handlers
document.getElementById('resolutionSelect').addEventListener('change', (e) => {
    const resolution = e.target.value;
    filterScanLevelsByResolution(resolution);
});

document.getElementById('scanLevelSelect').addEventListener('change', async (e) => {
    const scanIndex = parseInt(e.target.value);
    const resolution = document.getElementById('resolutionSelect').value;

    if (isNaN(scanIndex) || !window.radarFileData) {
        return; // No valid selection yet
    }

    console.log(`Display heatmap - Scan: ${scanIndex}, Resolution: ${resolution}`);
    await displayRadarHeatmap(scanIndex, resolution);
});

// Accordion toggle functionality
function toggleAccordion(headerElement, contentElement) {
    const isExpanded = headerElement.getAttribute('aria-expanded') === 'true';
    const icon = headerElement.querySelector('.accordion-header__icon');

    if (isExpanded) {
        // Collapse
        headerElement.setAttribute('aria-expanded', 'false');
        contentElement.style.display = 'none';
        icon.textContent = '▼'; // Down arrow when collapsed
    } else {
        // Expand
        headerElement.setAttribute('aria-expanded', 'true');
        contentElement.style.display = 'block';
        icon.textContent = '▲'; // Up arrow when expanded
    }
}

// Setup accordion event listeners
document.addEventListener('DOMContentLoaded', () => {
    const step1Header = document.getElementById('step1Header');
    const step1Content = document.getElementById('step1Content');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');

    // Add click handlers for accordion headers
    step1Header.addEventListener('click', () => {
        toggleAccordion(step1Header, step1Content);
    });

    step2Header.addEventListener('click', () => {
        toggleAccordion(step2Header, step2Content);
    });

    // Initialize the app
    initializeApp();
});