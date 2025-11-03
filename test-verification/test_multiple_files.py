"""
Test Multiple NEXRAD Level 2 Files from AWS S3 using PyART
Verifies the implementation with different sites, dates, and file formats
"""

import pyart
from pyart.io.nexrad_level2 import NEXRADLevel2File
from pyart.io.common import prepare_for_read
import json
import numpy as np
import time

# Test files from different sites, dates, and formats
TEST_FILES = [
    {
        'name': 'KCBW_2000',
        'uri': 's3://unidata-nexrad-level2/2000/08/08/KCBW/KCBW20000808_003027.gz',
        'site': 'KCBW',
        'date': '2000/08/08',
        'description': 'Year 2000, .gz compressed'
    },
    {
        'name': 'KBBX_2016',
        'uri': 's3://unidata-nexrad-level2/2016/12/10/KBBX/KBBX20161210_003057_V06',
        'site': 'KBBX',
        'date': '2016/12/10',
        'description': 'Year 2016, V06 format'
    },
    {
        'name': 'KHGX_2022',
        'uri': 's3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06',
        'site': 'KHGX',
        'date': '2022/03/22',
        'description': 'Year 2022, V06 format (reference)'
    }
]

def test_file(test_config):
    """Test a single file"""
    print('\n' + '=' * 80)
    print(f"Testing: {test_config['name']}")
    print(f"File: {test_config['uri']}")
    print(f"Description: {test_config['description']}")
    print('=' * 80)

    try:
        start_time = time.time()

        # Read the NEXRAD archive using NEXRADLevel2File directly
        file_handle = prepare_for_read(test_config['uri'], storage_options={'anon': True})
        nexrad_file = NEXRADLevel2File(file_handle)

        elapsed_time = time.time() - start_time

        # Collect results
        result = {
            'test_name': test_config['name'],
            'test_uri': test_config['uri'],
            'test_site': test_config['site'],
            'test_date': test_config['date'],

            # File info
            'volume_header': {
                'tape': str(nexrad_file.volume_header['tape']),
                'extension': str(nexrad_file.volume_header['extension']),
                'date': int(nexrad_file.volume_header['date']),
                'time': int(nexrad_file.volume_header['time']),
                'icao': str(nexrad_file.volume_header['icao'])
            },
            'vcp_pattern': nexrad_file.get_vcp_pattern(),
            'nscans': nexrad_file.nscans,
            'location': list(nexrad_file.location()),

            # Performance
            'parse_time_seconds': round(elapsed_time, 2),

            # Scan info
            'scan_info': nexrad_file.scan_info(),
            'nrays_per_scan': {},

            # Available moments
            'moments_summary': {},

            # Sample data
            'sample_data': {}
        }

        # Get rays per scan
        for scan in range(nexrad_file.nscans):
            result['nrays_per_scan'][f'scan_{scan}'] = nexrad_file.get_nrays(scan)

        # Check all common moments
        moments_to_check = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO', 'CFP']

        for moment in moments_to_check:
            try:
                range_info = nexrad_file.get_range(0, moment)
                max_ngates = len(range_info)
                data = nexrad_file.get_data(moment, max_ngates)

                # Get scans with this moment
                scans_with_moment = []
                scan_info = nexrad_file.scan_info()
                for scan_idx, scan_data in enumerate(scan_info):
                    if moment in scan_data['moments']:
                        scans_with_moment.append(scan_idx)

                result['moments_summary'][moment] = {
                    'available': True,
                    'scans_with_data': scans_with_moment,
                    'num_scans': len(scans_with_moment),
                    'data_shape': list(data.shape),
                    'first_gate': int(range_info[0]),
                    'gate_spacing': int(range_info[1] - range_info[0]) if len(range_info) > 1 else 0
                }

                # Sample data (first 5 valid values)
                valid_samples = []
                for val in data[0, :]:
                    if not np.isnan(val) and not np.ma.is_masked(val):
                        valid_samples.append(float(val))
                        if len(valid_samples) >= 5:
                            break

                result['sample_data'][moment] = valid_samples

                print(f"  [OK] {moment}: {len(scans_with_moment)} scans, shape {data.shape}")

            except Exception as e:
                result['moments_summary'][moment] = {
                    'available': False,
                    'error': str(e)
                }
                print(f"  [--] {moment}: Not available")

        # Print summary
        print(f"\nSummary:")
        print(f"  Site: {nexrad_file.volume_header['icao'].decode().strip()}")
        print(f"  Location: {result['location']}")
        print(f"  VCP: {result['vcp_pattern']}")
        print(f"  Scans: {result['nscans']}")
        print(f"  Parse Time: {result['parse_time_seconds']}s")

        available_moments = [m for m, info in result['moments_summary'].items() if info.get('available', False)]
        print(f"  Available Moments: {', '.join(available_moments)}")

        return {'success': True, 'result': result}

    except Exception as error:
        print(f"\n[ERROR] Testing {test_config['name']}: {str(error)}")
        import traceback
        traceback.print_exc()

        return {
            'success': False,
            'test_name': test_config['name'],
            'test_uri': test_config['uri'],
            'error': str(error)
        }

def main():
    print('=' * 80)
    print('NEXRAD Level 2 File - Multi-File Verification Test (Python/PyART)')
    print('=' * 80)

    results = []

    for test_config in TEST_FILES:
        result = test_file(test_config)
        results.append(result)

        # Small delay between tests
        time.sleep(1)

    # Save all results
    output_path = 'output/multi_file_test_results_py.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, default=str)

    # Print final summary
    print('\n' + '=' * 80)
    print('FINAL SUMMARY')
    print('=' * 80)

    success_count = 0
    fail_count = 0

    for result in results:
        status = 'PASS' if result['success'] else 'FAIL'
        name = result.get('test_name', result.get('result', {}).get('test_name', 'Unknown'))

        if result['success']:
            success_count += 1
            nscans = result['result']['nscans']
            moments = len([m for m, info in result['result']['moments_summary'].items() if info.get('available', False)])
            print(f"[{status}] - {name}: {nscans} scans, {moments} moments")
        else:
            fail_count += 1
            print(f"[{status}] - {name}: {result.get('error', 'Unknown error')}")

    print(f"\nTests Passed: {success_count}/{len(results)}")
    print(f"Tests Failed: {fail_count}/{len(results)}")
    print(f"\nResults saved to: {output_path}")

    return 0 if fail_count == 0 else 1

if __name__ == '__main__':
    exit(main())
