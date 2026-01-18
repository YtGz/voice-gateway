import { PvRecorder } from "@picovoice/pvrecorder-node";
import { PvSpeaker } from "@picovoice/pvspeaker-node";

const PREFERRED_DEVICE_PATTERNS = [
  /space\s*max/i,
  /beyerdynamic/i,
];

export function findPreferredInputDevice(): number {
  const devices = PvRecorder.getAvailableDevices();
  return findMatchingDevice(devices);
}

export function findPreferredOutputDevice(): number {
  const devices = PvSpeaker.getAvailableDevices();
  return findMatchingDevice(devices);
}

function findMatchingDevice(devices: string[]): number {
  for (const pattern of PREFERRED_DEVICE_PATTERNS) {
    const index = devices.findIndex((d) => pattern.test(d));
    if (index >= 0) {
      return index;
    }
  }
  return -1;
}

export function resolveInputDevice(configIndex: number): { index: number; name: string } {
  const devices = PvRecorder.getAvailableDevices();
  
  if (configIndex >= 0) {
    return { 
      index: configIndex, 
      name: devices[configIndex] ?? "Unknown" 
    };
  }
  
  const preferred = findPreferredInputDevice();
  if (preferred >= 0) {
    return { 
      index: preferred, 
      name: devices[preferred] 
    };
  }
  
  return { index: -1, name: "System default" };
}

export function resolveOutputDevice(configIndex: number): { index: number; name: string } {
  const devices = PvSpeaker.getAvailableDevices();
  
  if (configIndex >= 0) {
    return { 
      index: configIndex, 
      name: devices[configIndex] ?? "Unknown" 
    };
  }
  
  const preferred = findPreferredOutputDevice();
  if (preferred >= 0) {
    return { 
      index: preferred, 
      name: devices[preferred] 
    };
  }
  
  return { index: -1, name: "System default" };
}
