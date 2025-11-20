/**
 * UI Controller Module
 * Handles all DOM interactions, UI updates, and user input
 */

/**
 * Populate year selector
 */
export function populateYearSelector() {
    const yearSelect = document.getElementById('yearSelect');
    const currentYear = new Date().getFullYear();

    for (let year = currentYear; year >= 1991; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearSelect.appendChild(option);
    }
}

/**
 * Populate month selector
 */
export function populateMonthSelector() {
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

/**
 * Populate day selector
 */
export function populateDaySelector() {
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

/**
 * Display available times
 */
export function displayAvailableTimes(times, onTimeSelect) {
    const timeSelector = document.getElementById('timeSelector');
    const timesList = document.getElementById('timesList');

    timeSelector.style.display = 'block';
    timesList.innerHTML = '';

    const heading = timeSelector.querySelector('.time-selector__heading');
    if (heading) {
        heading.textContent = `Available Times (${times.length} scans - Click to Load)`;
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

            if (onTimeSelect) {
                onTimeSelect(time);
            }
        });

        timesList.appendChild(timeItem);
    });
}

/**
 * Populate scan level selector
 */
export function populateScanLevelSelector(scans) {
    const scanLevelSelect = document.getElementById('scanLevelSelect');
    scanLevelSelect.innerHTML = '<option value="">Select Scan</option>';

    scans.forEach(scan => {
        const option = document.createElement('option');
        option.value = scan.index;
        option.textContent = `${scan.elevAngle.toFixed(2)}° (${scan.nrays} radials)`;
        scanLevelSelect.appendChild(option);
    });

    scanLevelSelect.disabled = false;
}

/**
 * Show status message
 */
export function showStatus(elementId, type, message) {
    const statusDiv = document.getElementById(elementId);
    if (!statusDiv) return;

    statusDiv.className = `status-message ${type}`;
    statusDiv.innerHTML = message;
}

/**
 * Update selected site display
 */
export function updateSelectedSiteDisplay(site) {
    document.getElementById('selectedSite').innerHTML = `
        <strong>Selected:</strong>&nbsp;${site.code} - ${site.name}, ${site.state}
    `;

    const selectRadarBtn = document.getElementById('selectRadarBtn');
    if (selectRadarBtn) {
        selectRadarBtn.disabled = false;
    }
}

/**
 * Progress to Step 2
 */
export function progressToStep2(site) {
    const step1Content = document.getElementById('step1Content');
    const step1Status = document.getElementById('step1Status');
    const step2Section = document.querySelector('[data-step="2"]');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');

    if (step1Content) step1Content.style.display = 'none';
    if (step1Status) step1Status.textContent = '✓';

    if (step2Section) step2Section.classList.remove('accordion-section--disabled');
    if (step2Header) step2Header.setAttribute('aria-expanded', 'true');
    if (step2Content) step2Content.style.display = 'block';

    // Show right panel and add site info
    const precipitationPanel = document.querySelector('.panel--precipitation');
    const dataInfoCard = document.getElementById('dataInfoCard');
    const cardSiteInfo = document.getElementById('cardSiteInfo');
    const cardSiteName = document.getElementById('cardSiteName');

    if (precipitationPanel) precipitationPanel.style.display = 'block';
    if (dataInfoCard) dataInfoCard.style.display = 'block';
    if (cardSiteInfo && site) {
        cardSiteInfo.style.display = 'flex';
        cardSiteName.textContent = `${site.code} - ${site.name}, ${site.state}`;
    }
}

/**
 * Progress to Step 3
 */
export function progressToStep3(date, time) {
    const step2Content = document.getElementById('step2Content');
    const step2Status = document.getElementById('step2Status');
    const step3Section = document.querySelector('[data-step="3"]');
    const step3Header = document.getElementById('step3Header');
    const step3Content = document.getElementById('step3Content');

    if (step2Content) step2Content.style.display = 'none';
    if (step2Status) step2Status.textContent = '✓';

    if (step3Section) step3Section.classList.remove('accordion-section--disabled');
    if (step3Header) step3Header.setAttribute('aria-expanded', 'true');
    if (step3Content) step3Content.style.display = 'block';

    // Show the cross-sectional heading now that we're in Step 3
    const crossSectionalHeading = document.getElementById('crossSectionalHeading');
    if (crossSectionalHeading) crossSectionalHeading.style.display = 'block';

    // Add date/time to info card
    const cardDateTime = document.getElementById('cardDateTime');
    const cardDate = document.getElementById('cardDate');
    const cardTime = document.getElementById('cardTime');
    const cardTimeValue = document.getElementById('cardTimeValue');

    if (cardDateTime && date) {
        cardDateTime.style.display = 'flex';
        cardDate.textContent = date;
    }
    if (cardTime && time) {
        cardTime.style.display = 'flex';
        cardTimeValue.textContent = time;
    }
}

/**
 * Update info card with radar data
 */
export function updateRadarInfoCard(radarData) {
    const cardVCP = document.getElementById('cardVCP');
    const cardVCPValue = document.getElementById('cardVCPValue');
    const cardScans = document.getElementById('cardScans');
    const cardScansValue = document.getElementById('cardScansValue');
    const cardRange = document.getElementById('cardRange');
    const cardRangeValue = document.getElementById('cardRangeValue');

    if (cardVCP) {
        cardVCP.style.display = 'flex';
        cardVCPValue.textContent = radarData.nexradFile.getVCPPattern();
    }
    if (cardScans) {
        cardScans.style.display = 'flex';
        cardScansValue.textContent = radarData.nexradFile.nscans;
    }
    if (cardRange) {
        cardRange.style.display = 'flex';
        cardRangeValue.textContent = `${(radarData.maxRange / 1000).toFixed(1)} km`;
    }
}

/**
 * Update info card with scan details
 */
export function updateScanInfoCard(scanDetails) {
    const cardElevation = document.getElementById('cardElevation');
    const cardElevationValue = document.getElementById('cardElevationValue');
    const cardReflectivity = document.getElementById('cardReflectivity');
    const cardReflectivityValue = document.getElementById('cardReflectivityValue');

    if (cardElevation) {
        cardElevation.style.display = 'flex';
        cardElevationValue.textContent = `${scanDetails.elevAngle.toFixed(2)}°`;
    }
    if (cardReflectivity) {
        cardReflectivity.style.display = 'flex';
        cardReflectivityValue.textContent = `${scanDetails.minVal.toFixed(1)} to ${scanDetails.maxVal.toFixed(1)} dBZ`;
    }

    // Update the precipitation status message to show hover instructions
    const precipitationStatusMessage = document.getElementById('precipitationStatusMessage');
    if (precipitationStatusMessage) {
        precipitationStatusMessage.textContent = 'Hover over the radar area to view detailed cross-sectional data. Use mouse wheel to adjust zoom area size.';
    }
}

/**
 * Reset all UI to initial state
 */
export function resetUI() {
    // Clear search
    const searchInput = document.getElementById('siteSearch');
    if (searchInput) searchInput.value = '';

    // Clear selected site display
    const selectedSiteDiv = document.getElementById('selectedSite');
    if (selectedSiteDiv) selectedSiteDiv.innerHTML = '';

    // Reset date selectors
    document.getElementById('yearSelect').value = '';
    document.getElementById('monthSelect').value = '';
    document.getElementById('monthSelect').disabled = true;
    document.getElementById('daySelect').value = '';
    document.getElementById('daySelect').disabled = true;

    // Clear status messages
    showStatus('dataStatus', '', '');
    showStatus('radarStatus', '', '');

    // Hide time selector
    const timeSelector = document.getElementById('timeSelector');
    if (timeSelector) timeSelector.style.display = 'none';

    // Reset accordion
    const step1Header = document.getElementById('step1Header');
    const step1Content = document.getElementById('step1Content');
    const step1Status = document.getElementById('step1Status');
    const step2Section = document.querySelector('[data-step="2"]');
    const step2Header = document.getElementById('step2Header');
    const step2Content = document.getElementById('step2Content');
    const step2Status = document.getElementById('step2Status');
    const step3Section = document.querySelector('[data-step="3"]');
    const step3Header = document.getElementById('step3Header');
    const step3Content = document.getElementById('step3Content');
    const step3Status = document.getElementById('step3Status');

    if (step1Header) step1Header.setAttribute('aria-expanded', 'true');
    if (step1Content) step1Content.style.display = 'block';
    if (step1Status) step1Status.textContent = '';

    if (step2Section) step2Section.classList.add('accordion-section--disabled');
    if (step2Header) step2Header.setAttribute('aria-expanded', 'false');
    if (step2Content) step2Content.style.display = 'none';
    if (step2Status) step2Status.textContent = '';

    if (step3Section) step3Section.classList.add('accordion-section--disabled');
    if (step3Header) step3Header.setAttribute('aria-expanded', 'false');
    if (step3Content) step3Content.style.display = 'none';
    if (step3Status) step3Status.textContent = '';

    // Disable "Select Radar" button
    const selectRadarBtn = document.getElementById('selectRadarBtn');
    if (selectRadarBtn) selectRadarBtn.disabled = true;

    // Hide panels
    const precipitationPanel = document.querySelector('.panel--precipitation');
    if (precipitationPanel) precipitationPanel.style.display = 'none';

    // Hide cross-sectional heading
    const crossSectionalHeading = document.getElementById('crossSectionalHeading');
    if (crossSectionalHeading) crossSectionalHeading.style.display = 'none';

    // Reset precipitation status message
    const precipitationStatusMessage = document.getElementById('precipitationStatusMessage');
    if (precipitationStatusMessage) {
        precipitationStatusMessage.textContent = 'Select a timestamp, resolution and scan level to retrieve and visualize radar data.';
    }

    // Reset info card
    const dataInfoCard = document.getElementById('dataInfoCard');
    if (dataInfoCard) dataInfoCard.style.display = 'none';

    const cardItems = document.querySelectorAll('.data-info-item');
    cardItems.forEach(item => item.style.display = 'none');

    // Hide zoom window
    const zoomWindow = document.getElementById('zoomWindow');
    if (zoomWindow) zoomWindow.style.display = 'none';

    console.log('UI reset to initial state');
}
