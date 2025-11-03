"""
Test NEXRAD Level 2 File Reading from AWS S3 using PyART
Mirrors the JavaScript test for direct comparison
"""

import pyart
from pyart.io.nexrad_level2 import NEXRADLevel2File
from pyart.io.common import prepare_for_read
import json
import numpy as np

def main():
    print('=== NEXRAD AWS S3 Test (Python/PyART) ===\n')

    # Test file from PyART example
    aws_nexrad_level2_file = "s3://unidata-nexrad-level2/2022/03/22/KHGX/KHGX20220322_120125_V06"

    print(f'Reading file: {aws_nexrad_level2_file}\n')

    # Read the NEXRAD archive using PyART's NEXRADLevel2File directly
    # This mirrors what the JavaScript implementation does
    file_handle = prepare_for_read(aws_nexrad_level2_file, storage_options={'anon': True})
    nexrad_file = NEXRADLevel2File(file_handle)

    print('Successfully read NEXRAD archive:')
    print(f"  - Site ID: {nexrad_file.volume_header['icao'].decode().strip()}")
    print(f"  - VCP: {nexrad_file.get_vcp_pattern()}")
    print(f"  - Scans: {nexrad_file.nscans}")

    print('\n=== File Information ===')

    # Extract comprehensive data for comparison with JavaScript
    output = {
        # Basic info
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

        # VCP information (if available)
        'vcp': {},

        # Scan information
        'scan_info': nexrad_file.scan_info(),

        # Number of rays per scan
        'nrays_per_scan': {},

        # Target angles
        'target_angles': nexrad_file.get_target_angles().tolist(),

        # Times
        'times': {},

        # Angular data (first 5 values for comparison)
        'azimuth_angles_sample': [],
        'elevation_angles_sample': [],

        # Nyquist velocity and unambiguous range (first 5 values)
        'nyquist_vel_sample': [],
        'unambiguous_range_sample': [],

        # Moment data
        'moments': {}
    }

    # Get VCP info if available
    if hasattr(nexrad_file, 'vcp') and nexrad_file.vcp is not None:
        output['vcp'] = {
            'pattern_number': int(nexrad_file.vcp['msg5_header']['pattern_number']) if 'msg5_header' in nexrad_file.vcp else None,
            'num_cuts': int(nexrad_file.vcp['msg5_header']['num_cuts']) if 'msg5_header' in nexrad_file.vcp else None,
            'doppler_vel_res': int(nexrad_file.vcp['msg5_header']['doppler_vel_res']) if 'msg5_header' in nexrad_file.vcp else None,
            'pulse_width': int(nexrad_file.vcp['msg5_header']['pulse_width']) if 'msg5_header' in nexrad_file.vcp else None
        }

    # Get number of rays for each scan
    for scan in range(nexrad_file.nscans):
        output['nrays_per_scan'][f'scan_{scan}'] = nexrad_file.get_nrays(scan)

    # Get times (returns tuple of (base_time, time_offset_array))
    times = nexrad_file.get_times()
    print(f"Times type: {type(times)}, value: {times if not isinstance(times, tuple) or len(times) < 2 else (times[0], 'array...')}")

    if isinstance(times, tuple) and len(times) == 2:
        base_time, time_offsets = times
        output['times'] = {
            'base_time': str(base_time),
            'time_offset_sample': time_offsets[:5].tolist() if hasattr(time_offsets, 'tolist') else list(time_offsets[:5])
        }
    else:
        output['times'] = {
            'base_time': str(times),
            'time_offset_sample': []
        }

    # Get angular data samples
    azimuth_angles = nexrad_file.get_azimuth_angles()
    elevation_angles = nexrad_file.get_elevation_angles()
    output['azimuth_angles_sample'] = azimuth_angles[:5].tolist()
    output['elevation_angles_sample'] = elevation_angles[:5].tolist()

    # Get Nyquist velocity and unambiguous range samples
    nyquist_vel = nexrad_file.get_nyquist_vel()
    unambig_range = nexrad_file.get_unambigous_range()
    output['nyquist_vel_sample'] = nyquist_vel[:5].tolist()
    output['unambiguous_range_sample'] = unambig_range[:5].tolist()

    # Get moment data for common NEXRAD moments
    moments_to_check = ['REF', 'VEL', 'SW', 'ZDR', 'PHI', 'RHO']

    for moment in moments_to_check:
        try:
            # Try to get range for first scan
            range_info = nexrad_file.get_range(0, moment)
            max_ngates = len(range_info)

            # Get data for this moment
            data = nexrad_file.get_data(moment, max_ngates)

            output['moments'][moment] = {
                'available': True,
                'scans_with_data': [],
                'max_ngates': max_ngates,
                'data_shape': list(data.shape),

                # Sample data (first ray, first 10 gates)
                'data_sample': data[0, :10].tolist(),

                # Range sample (first 10 gates)
                'range_sample': range_info[:10].tolist()
            }

            # Check which scans have this moment
            scan_info = nexrad_file.scan_info()
            for scan_idx, scan_data in enumerate(scan_info):
                if moment in scan_data['moments']:
                    output['moments'][moment]['scans_with_data'].append(scan_idx)

            print(f"Moment {moment}: Available in scans {output['moments'][moment]['scans_with_data']}, shape {data.shape}")

        except Exception as e:
            output['moments'][moment] = {
                'available': False,
                'error': str(e)
            }
            print(f"Moment {moment}: Not available - {str(e)}")

    # Print summary
    print('\n=== Summary ===')
    print(f"Site ID: {nexrad_file.volume_header['icao'].decode().strip()}")
    print(f"Location: {output['location']}")
    print(f"VCP Pattern: {output['vcp_pattern']}")
    print(f"Number of scans: {output['nscans']}")
    print(f"Available moments: {', '.join([m for m, info in output['moments'].items() if info.get('available', False)])}")

    # Save output to file
    output_path = 'output/aws_nexrad_output_py.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\n✓ Output saved to: {output_path}")

    print('\nTest complete!')

if __name__ == '__main__':
    main()
