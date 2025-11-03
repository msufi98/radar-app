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

// Initialize S3 client for public access
const s3Client = new S3Client({
    region: 'us-east-1',
    credentials: {
        accessKeyId: 'anonymous',
        secretAccessKey: 'anonymous'
    },
    signer: { sign: async (request) => request }
});

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
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(s3Url)}`;

    try {
        console.log('Fetching available sites for:', selectedDate);
        const response = await fetch(proxyUrl);

        if (response.ok) {
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
            statusDiv.innerHTML = `<span class="checkmark">✓</span> ${sites.length} radar sites available for selected date`;

        } else {
            throw new Error(`Failed to fetch: ${response.status}`);
        }
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

        // Show marker only if it matches search AND is available
        marker.map = (matchesSearch && isAvailable) ? map : null;

        // Update marker appearance for unavailable sites
        if (marker.content) {
            if (!isAvailable) {
                marker.content.style.backgroundColor = '#cbd5e0';
                marker.content.style.opacity = '0.5';
            } else if (site.code === selectedSite?.code) {
                marker.content.style.backgroundColor = '#4a6a8e';
                marker.content.style.transform = 'scale(1.2)';
            } else {
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

    // Using api.allorigins.win which is more reliable
    const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(s3Url)}`;

    console.log('S3 URL:', s3Url);
    console.log('Proxy URL:', proxyUrl);

    try {
        console.log('Fetching via CORS proxy...');
        const response = await fetch(proxyUrl);

        if (response.ok) {
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
        } else {
            throw new Error(`Proxy returned status: ${response.status}`);
        }
    } catch (error) {
        console.error('Iowa CORS proxy failed:', error);

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
        heading.textContent = `Available Times (${times.length} scans)`;
    }

    times.forEach(time => {
        const timeItem = document.createElement('div');
        timeItem.className = 'time-item';
        timeItem.textContent = time.display;
        timeItem.dataset.fileName = time.fileName;

        timeItem.addEventListener('click', () => {
            document.querySelectorAll('.time-item').forEach(item => {
                item.classList.remove('selected');
            });
            timeItem.classList.add('selected');
            selectedTime = time.fileName;
            updateProceedButton();
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

function updateProceedButton() {
    const proceedBtn = document.getElementById('proceedBtn');
    proceedBtn.disabled = !(selectedSite && selectedDate && selectedTime);
}

document.getElementById('proceedBtn').addEventListener('click', async () => {
    if (selectedSite && selectedDate && selectedTime) {
        await loadRadarData();
    }
});

async function loadRadarData() {
    const statusDiv = document.getElementById('dataStatus');

    // Show loading progress
    statusDiv.className = 'status-message loading';
    statusDiv.innerHTML = '<span class="spinner"></span> Loading radar data...';

    // Construct the S3 URI for the file
    const s3Uri = `s3://unidata-nexrad-level2/${selectedDate}/${selectedSite.code}/${selectedTime}`;

    try {
        console.log('Loading radar file:', selectedTime);
        console.log('S3 URI:', s3Uri);

        // Call read_nexrad_archive to load and parse the data
        const nexradFile = await read_nexrad_archive(s3Uri, {
            storage_options: { anon: true }
        });

        // Display parsed information
        statusDiv.className = 'status-message success';
        statusDiv.innerHTML = `
            <span class="checkmark">✓</span> Radar data loaded successfully!<br>
            <strong>Site:</strong> ${nexradFile.volumeHeader.icao.trim()}<br>
            <strong>VCP:</strong> ${nexradFile.getVCPPattern()}<br>
            <strong>Scans:</strong> ${nexradFile.nscans}<br>
            <strong>Radials:</strong> ${nexradFile.radialRecords.length}
        `;

        // Store the parsed data for the viewer
        window.radarFileData = {
            site: selectedSite,
            date: selectedDate,
            fileName: selectedTime,
            nexradFile: nexradFile
        };

        console.log('Radar data ready for viewer');

    } catch (error) {
        console.error('Error loading radar data:', error);
        statusDiv.className = 'status-message error';
        statusDiv.innerHTML = `
            <span class="error-icon">✗</span> Failed to load radar data<br>
            <small>${error.message}</small>
        `;
    }
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

    // Clear status message
    const statusDiv = document.getElementById('dataStatus');
    if (statusDiv) {
        statusDiv.className = 'status-message';
        statusDiv.innerHTML = '';
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

    // Disable proceed button
    updateProceedButton();

    // Reset all markers to default state
    filterMarkersBySiteAvailability();

    // Close any open info windows
    if (infoWindow) {
        infoWindow.close();
    }

    console.log('Filters and selections reset');
}

document.addEventListener('DOMContentLoaded', initializeApp);