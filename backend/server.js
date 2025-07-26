const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Enable CORS for all routes
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(bodyParser.json());

// Simple in-memory storage
let devices = [];
let connections = [];
let currentNetworkMode = 'single'; // Default network mode

// Test endpoint to verify server is working
app.get('/', (req, res) => {
  res.json({ 
    message: 'Infrastructure Designer Backend is running!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET / - This message',
      'GET /health - Health check',
      'GET /clear-database - Clear all data',
      'POST /devices - Create device (supports ip parameter)',
      'GET /devices - List devices',
      'POST /devices/delete - Delete device',
      'POST /connections - Create connection',
      'GET /connections - List connections',
      'GET /export/kubevirt - Export complete infrastructure',
      'GET /export/kubevirt-pvcs - Export PVCs only',
      'GET /export/kubevirt-vms - Export VMs with networking',
      'GET /export/kubevirt-basic - Export basic VMs (pod network only)',
      'GET /network-topology - Analyze network topology'
    ]
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    uptime: process.uptime(),
    devices: devices.length,
    connections: connections.length
  });
});

// Utility functions for speed conversion
const convertSpeedToMbps = (speedStr) => {
  const units = {
    bps: 1 / 1000000,
    Kbps: 1 / 1000,
    Mbps: 1,
    Gbps: 1000,
    Tbps: 1000000
  };

  const match = speedStr.match(/^(\d+(?:\.\d+)?)\s?([a-zA-Z]+)$/);
  if (!match) {
    throw new Error('Invalid speed format');
  }

  const value = parseFloat(match[1]);
  const unit = match[2];

  if (!units[unit]) {
    throw new Error(`Unsupported unit: ${unit}`);
  }

  return { value: value * units[unit], unit };
};

const convertSpeedFromMbps = (speed, unit) => {
  const units = {
    bps: 1000000,
    Kbps: 1000,
    Mbps: 1,
    Gbps: 1 / 1000,
    Tbps: 1 / 1000000
  };

  if (!units[unit]) {
    throw new Error(`Unsupported unit: ${unit}`);
  }

  return speed * units[unit];
};

// Clear database endpoint
app.get('/clear-database', (req, res) => {
  devices = [];
  connections = [];
  console.log('✅ Database cleared');
  res.json({ message: 'Database cleared', devices: 0, connections: 0 });
});

// Device endpoints
app.post('/devices', (req, res) => {
  console.log('📝 Creating device:', req.body);
  const { id, type, cpu, memory, storage, ip } = req.body;
  
  try {
    // Check if device already exists
    const existingDevice = devices.find(d => d.id === id);
    if (existingDevice) {
      return res.status(400).json({ error: `Device with ID ${id} already exists` });
    }

    // Validate IP address if provided
    if (ip && ip.trim()) {
      
      // Check if IP is already assigned
      const existingIP = devices.find(d => d.ip === ip.trim());
      if (existingIP) {
        return res.status(400).json({ error: `IP address ${ip.trim()} is already assigned to device ${existingIP.id}` });
      }
    }

    const device = { 
      id, 
      type, 
      cpu, 
      memory, 
      storage, 
      ip: ip && ip.trim() ? ip.trim() : null,
      createdAt: new Date().toISOString() 
    };
    devices.push(device);
    console.log('✅ Device created:', device);
    res.json({ success: true, device });
  } catch (error) {
    console.error('❌ Error creating device:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/devices', (req, res) => {
  console.log('📋 Listing devices, count:', devices.length);
  res.json(devices);
});

app.post('/devices/delete', (req, res) => {
  const { deviceId } = req.body;
  console.log('🗑️ Deleting device:', deviceId);
  
  try {
    const initialDeviceCount = devices.length;
    const initialConnectionCount = connections.length;
    
    // Remove device
    devices = devices.filter(device => device.id !== deviceId);
    
    // Remove all connections involving this device
    connections = connections.filter(
      connection => connection.from !== deviceId && connection.to !== deviceId
    );
    
    const devicesDeleted = initialDeviceCount - devices.length;
    const connectionsDeleted = initialConnectionCount - connections.length;
    
    console.log(`✅ Deleted: ${devicesDeleted} device(s), ${connectionsDeleted} connection(s)`);
    res.json({ 
      success: true, 
      message: `Device ${deviceId} deleted`,
      devicesDeleted,
      connectionsDeleted
    });
  } catch (error) {
    console.error('❌ Error deleting device:', error);
    res.status(500).json({ error: error.message });
  }
});

// Connection endpoints
app.post('/connections', (req, res) => {
  const { from, to, speed } = req.body;
  console.log('🔗 Creating connection:', { from, to, speed });
  
  try {
    // Find devices
    const fromDevice = devices.find(d => d.id === from);
    const toDevice = devices.find(d => d.id === to);
    
    if (!fromDevice || !toDevice) {
      console.error('❌ One or both devices not found');
      return res.status(404).json({ error: 'One or both devices not found.' });
    }

    // Check if VM to VM connection (prohibited)
    if (fromDevice.type === 'vm' && toDevice.type === 'vm') {
      console.error('❌ VM to VM connection prohibited');
      return res.status(400).json({ error: 'Connecting VM with VM is prohibited.' });
    }

    // Check if connection already exists
    const existingConnection = connections.find(
      c => (c.from === from && c.to === to) || (c.from === to && c.to === from)
    );
    if (existingConnection) {
      return res.status(400).json({ error: 'Connection already exists between these devices' });
    }

    // Convert speed
    const { value: speedMbps, unit } = convertSpeedToMbps(speed);
    
    // Create connection
    const connection = {
      from,
      to,
      speed: speedMbps,
      unit,
      originalSpeed: speed,
      createdAt: new Date().toISOString()
    };
    
    connections.push(connection);
    console.log('✅ Connection created:', connection);
    res.json({ success: true, connection });
  } catch (error) {
    console.error('❌ Error creating connection:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/connections', (req, res) => {
  console.log('🔗 Listing connections, count:', connections.length);
  try {
    const formattedConnections = connections.map(conn => ({
      from: conn.from,
      to: conn.to,
      speed: conn.originalSpeed || `${convertSpeedFromMbps(conn.speed, conn.unit)}${conn.unit}`
    }));
    res.json(formattedConnections);
  } catch (error) {
    console.error('❌ Error fetching connections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Network topology analysis for KubeVirt - Configurable Mode
function analyzeKubeVirtTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  // Use the current network mode
  switch (currentNetworkMode) {
    case 'single':
      return analyzeSingleNetworkTopology();
    case 'device-type':
      return analyzeDeviceTypeTopology();
    case 'vlan':
      return analyzeVLANTopology();
    case 'connection-based':
    default:
      return analyzeConnectionBasedTopology();
  }
}

// Single Network Mode - All devices on one network
function analyzeSingleNetworkTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  if (devices.length > 0) {
    const segmentName = 'net1';
    const subnet = '192.168.1.0/24';
    
    networkSegments.set(segmentName, {
      name: segmentName,
      subnet: subnet,
      devices: devices.map(d => d.id),
      speed: '1 Gbps'
    });
    
    devices.forEach(device => {
      deviceNetworks.set(device.id, [segmentName]);
    });
  }
  
  return { networkSegments, deviceNetworks };
}

// Connection-Based Mode - Each connection creates a network segment
function analyzeConnectionBasedTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  let segmentCounter = 1;
  const processedConnections = new Set();
  
  connections.forEach(connection => {
    const connectionKey = `${connection.from}-${connection.to}`;
    const reverseKey = `${connection.to}-${connection.from}`;
    
    if (!processedConnections.has(connectionKey) && !processedConnections.has(reverseKey)) {
      const segmentName = `net${segmentCounter}`;
      const subnet = `192.168.${segmentCounter + 10}.0/24`;
      
      networkSegments.set(segmentName, {
        name: segmentName,
        subnet: subnet,
        devices: [connection.from, connection.to],
        speed: connection.originalSpeed
      });
      
      [connection.from, connection.to].forEach(deviceId => {
        if (!deviceNetworks.has(deviceId)) {
          deviceNetworks.set(deviceId, []);
        }
        deviceNetworks.get(deviceId).push(segmentName);
      });
      
      processedConnections.add(connectionKey);
      processedConnections.add(reverseKey);
      segmentCounter++;
    }
  });
  
  return { networkSegments, deviceNetworks };
}

// Device-Type Based Mode - Networks based on device types
function analyzeDeviceTypeTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  const networks = {
    'management': { subnet: '192.168.1.0/24', devices: [] },
    'dmz': { subnet: '192.168.10.0/24', devices: [] },
    'internal': { subnet: '192.168.100.0/24', devices: [] }
  };
  
  devices.forEach(device => {
    let networkType;
    if (device.type === 'router') {
      networkType = 'management';
    } else if (device.type === 'switch') {
      networkType = 'internal';
    } else {
      networkType = 'dmz';
    }
    
    networks[networkType].devices.push(device.id);
    deviceNetworks.set(device.id, [networkType]);
  });
  
  Object.entries(networks).forEach(([name, config]) => {
    if (config.devices.length > 0) {
      networkSegments.set(name, {
        name: name,
        subnet: config.subnet,
        devices: config.devices,
        speed: '1 Gbps'
      });
    }
  });
  
  return { networkSegments, deviceNetworks };
}

// VLAN-Based Mode - Connected devices form VLANs
function analyzeVLANTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  const deviceGroups = new Map();
  let vlanCounter = 10;
  
  devices.forEach(device => {
    if (!deviceGroups.has(device.id)) {
      const group = new Set([device.id]);
      const queue = [device.id];
      
      while (queue.length > 0) {
        const current = queue.shift();
        connections.forEach(conn => {
          if (conn.from === current && !group.has(conn.to)) {
            group.add(conn.to);
            queue.push(conn.to);
          } else if (conn.to === current && !group.has(conn.from)) {
            group.add(conn.from);
            queue.push(conn.from);
          }
        });
      }
      
      const vlanName = `vlan${vlanCounter}`;
      const subnet = `192.168.${vlanCounter}.0/24`;
      
      networkSegments.set(vlanName, {
        name: vlanName,
        subnet: subnet,
        devices: Array.from(group),
        speed: '1 Gbps'
      });
      
      group.forEach(deviceId => {
        deviceGroups.set(deviceId, vlanName);
        deviceNetworks.set(deviceId, [vlanName]);
      });
      
      vlanCounter++;
    }
  });
  
  return { networkSegments, deviceNetworks };
}

// Generate IP assignments for KubeVirt VMs - Single Network Mode with Custom IPs
function generateKubeVirtIPAssignments() {
  const { networkSegments, deviceNetworks } = analyzeKubeVirtTopology();
  const ipAssignments = new Map();
  
  // Track used IPs to avoid conflicts
  const usedIPs = new Set();
  const networkName = 'net1';
  const baseNetwork = '192.168.1';
  let autoIpCounter = 10;
  
  // First pass: assign custom IPs and track reserved IPs
  devices.forEach(device => {
    if (device.ip) {
      usedIPs.add(device.ip);
    }
  });
  
  // Reserved IPs
  usedIPs.add('192.168.1.1'); // Always reserve .1 for gateway
  
  devices.forEach(device => {
    let ip;
    
    // Use custom IP if specified
    if (device.ip) {
      ip = device.ip;
    } else {
      // Auto-assign based on device type
      if (device.type === 'router') {
        ip = `${baseNetwork}.1`; // Router gets .1 (gateway)
      } else if (device.type === 'switch') {
        // Find next available IP starting from .2
        while (usedIPs.has(`${baseNetwork}.${autoIpCounter}`) || autoIpCounter === 1) {
          autoIpCounter++;
        }
        ip = `${baseNetwork}.${autoIpCounter}`;
        autoIpCounter++;
      } else {
        // VMs get next available IP
        while (usedIPs.has(`${baseNetwork}.${autoIpCounter}`) || autoIpCounter === 1) {
          autoIpCounter++;
        }
        ip = `${baseNetwork}.${autoIpCounter}`;
        autoIpCounter++;
      }
      usedIPs.add(ip);
    }
    
    const assignments = [{
      network: networkName,
      ip: ip,
      subnet: `${baseNetwork}.0/24`,
      gateway: `${baseNetwork}.1` // Router is always the gateway
    }];
    
    ipAssignments.set(device.id, assignments);
  });
  
  return { ipAssignments, networkSegments };
}

// KubeVirt Export Endpoints
app.get('/export/kubevirt', (req, res) => {
  console.log('📦 Exporting to KubeVirt...');
  console.log(`📊 Current state: ${devices.length} devices, ${connections.length} connections`);
  
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generateKubeVirtInfrastructure(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure.yaml"');
    
    console.log('✅ KubeVirt YAML generated successfully');
    res.send(kubevirtYaml);
  } catch (error) {
    console.error('❌ Error exporting KubeVirt configuration:', error);
    res.status(500).json({ error: `Failed to export KubeVirt configuration: ${error.message}` });
  }
});

app.get('/export/kubevirt-pvcs', (req, res) => {
  console.log('📦 Exporting KubeVirt PVCs...');
  
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generatePVCsOnly(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure-pvcs.yaml"');
    
    console.log('✅ KubeVirt PVCs YAML generated successfully');
    res.send(kubevirtYaml);
  } catch (error) {
    console.error('❌ Error exporting KubeVirt PVCs:', error);
    res.status(500).json({ error: `Failed to export KubeVirt PVCs: ${error.message}` });
  }
});

app.get('/export/kubevirt-vms', (req, res) => {
  console.log('📦 Exporting KubeVirt VMs...');
  
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generateVMsOnly(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure-vms.yaml"');
    
    console.log('✅ KubeVirt VMs YAML generated successfully');
    res.send(kubevirtYaml);
  } catch (error) {
    console.error('❌ Error exporting KubeVirt VMs:', error);
    res.status(500).json({ error: `Failed to export KubeVirt VMs: ${error.message}` });
  }
});

// Export basic VMs without complex networking (for testing)
app.get('/export/kubevirt-basic', (req, res) => {
  console.log('📦 Exporting basic KubeVirt VMs...');
  
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generateBasicVMsOnly(devices);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-basic-vms.yaml"');
    
    console.log('✅ Basic KubeVirt VMs YAML generated successfully');
    res.send(kubevirtYaml);
  } catch (error) {
    console.error('❌ Error exporting basic VMs:', error);
    res.status(500).json({ error: `Failed to export basic VMs: ${error.message}` });
  }
});

// Generate basic VMs without complex networking
function generateBasicVMsOnly(devices) {
  const components = [];
  
  components.push(`# Basic KubeVirt VMs (Pod Network Only)
# Generated: ${new Date().toISOString()}
# 
# This creates VMs with basic pod networking only
# Use this for initial testing, then upgrade to full networking
#`);
  
  devices.forEach(device => {
    components.push(generateBasicVM(device));
  });
  
  return components.join('\n---\n');
}

// Generate basic VM with pod networking only
function generateBasicVM(device) {
  const deviceName = device.id.toLowerCase();
  const memory = device.memory ? device.memory.replace(/Gi|GB/i, 'G') : (device.type === 'vm' ? '2G' : '1G');
  const cpu = device.cpu ? parseInt(device.cpu.match(/\d+/)[0]) || 1 : (device.type === 'router' ? 2 : 1);
  
  return `# Basic ${device.type.toUpperCase()}: ${device.id}
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${deviceName}
  labels:
    kubevirt.io/os: linux
    device-type: ${device.type}
    device-id: ${device.id}
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: ${cpu}
        devices:
          disks:
          - disk:
              bus: virtio
            name: disk0
          - cdrom:
              bus: sata
              readonly: true
            name: cloudinitdisk
          interfaces:
          - name: default
            masquerade: {}
        machine:
          type: q35
        resources:
          requests:
            memory: ${memory}
      networks:
      - name: default
        pod: {}
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${deviceName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${deviceName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:password123
                debian:password123
              expire: False
            package_update: true
            packages:
              - net-tools
              - iputils-ping
              - traceroute
              - wget
              - curl
              - tcpdump
              - iperf3
              - openssh-server
            runcmd:
              - systemctl enable ssh
              - systemctl start ssh
              - echo "${device.id} (${device.type}) is ready on pod network"
              - ip addr show
        name: cloudinitdisk`;
}

// Generate complete KubeVirt infrastructure
function generateKubeVirtInfrastructure(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateKubeVirtIPAssignments();
  
  components.push(`# KubeVirt Infrastructure with Network Simulation
# Generated: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
#
# This creates a working network topology using KubeVirt VMs
# Each connection creates a dedicated network segment with proper IP addressing
# 
# NETWORK ARCHITECTURE:
# - Each connection between devices creates a separate NetworkAttachmentDefinition
# - Routers act as gateways (x.x.x.1) in their segments
# - Switches bridge traffic (x.x.x.2) 
# - VMs get sequential IPs (x.x.x.10+)
# - All devices can communicate within their network segments
#
# DEPLOYMENT:
# 1. Apply this complete file, or
# 2. Apply PVCs first, wait for import, then apply VMs
#`);

  // Generate NetworkAttachmentDefinitions for each connection
  components.push(generateNetworkAttachmentDefinitions(networkSegments));
  
  // Generate PVCs
  components.push('# ========================================');
  components.push('# Persistent Volume Claims');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateDevicePVC(device));
  });
  
  return components.join('\n---\n');
}

function generateVMsOnly(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateKubeVirtIPAssignments();
  
  components.push(`# KubeVirt VMs with Network Configuration
# Generated: ${new Date().toISOString()}
# 
# IMPORTANT: Apply after PVCs are ready (Status: Succeeded)
# Check with: kubectl get pvc
#`);
  
  // Generate VMs with network configuration
  components.push('# ========================================');
  components.push('# Virtual Machines with Network Setup');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

function generatePVCsOnly(devices, connections) {
  const components = [];
  const { networkSegments } = generateKubeVirtIPAssignments();
  
  components.push(`# KubeVirt PVCs and Network Setup
# Generated: ${new Date().toISOString()}
# 
# Apply this first and wait for CDI import completion
#`);
  
  // Generate NetworkAttachmentDefinitions
  components.push(generateNetworkAttachmentDefinitions(networkSegments));
  
  // Generate PVCs
  components.push('# ========================================');
  components.push('# Persistent Volume Claims');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateDevicePVC(device));
  });
  
  return components.join('\n---\n');
}

// Generate NetworkAttachmentDefinitions for each network segment
function generateNetworkAttachmentDefinitions(networkSegments) {
  const components = ['# Network Attachment Definitions for Device Connections'];
  
  networkSegments.forEach((segment, segmentName) => {
    const networkOctet = segment.subnet.split('.')[2];
    // Use very short bridge names to avoid Linux bridge limits (max 15 chars)
    const bridgeName = `br${networkOctet}`;
    // Create valid Kubernetes label (no slashes allowed)
    const subnetLabel = segment.subnet.replace(/[/.]/g, '-');
    
    components.push(`apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: ${segmentName}
  labels:
    network-type: infrastructure-segment
    network-subnet: "${subnetLabel}"
    network-octet: "${networkOctet}"
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "${segmentName}",
    "type": "bridge",
    "bridge": "${bridgeName}",
    "isDefaultGateway": false,
    "isGateway": false,
    "ipMasq": false,
    "hairpinMode": true,
    "ipam": {
      "type": "host-local",
      "subnet": "${segment.subnet}",
      "rangeStart": "192.168.${networkOctet}.10",
      "rangeEnd": "192.168.${networkOctet}.200"
    }
  }'`);
  });
  
  return components.join('\n---\n');
}

// Generate PVC for any device type
function generateDevicePVC(device) {
  const deviceName = device.id.toLowerCase();
  const storage = device.storage ? normalizeStorageQuantity(device.storage) : '10Gi';
  
  return `# PVC for ${device.type.toUpperCase()}: ${device.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${deviceName}-pvc"
  labels:
    app: containerized-data-importer
    device-type: ${device.type}
    device-id: ${device.id}
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: ${storage}
  storageClassName: nfs-client`;
}

// Generate VMs only with network configuration (using inline cloud-init)
function generateVMsOnly(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateKubeVirtIPAssignments();
  
  components.push(`# KubeVirt VMs with Network Configuration
# Generated: ${new Date().toISOString()}
# 
# IMPORTANT: Apply after PVCs are ready (Status: Succeeded)
# Check with: kubectl get pvc
#`);
  
  // Generate VMs with simplified cloud-init configuration
  components.push('# ========================================');
  components.push('# Virtual Machines with Network Setup');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

// Generate networked KubeVirt VM for any device type (with version naming)
function generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments) {
  // Add timestamp to VM name to avoid cloud-init caching
  const timestamp = new Date().toISOString().slice(0, 16).replace(/[:.T]/g, '').toLowerCase();
  const deviceName = `${device.id.toLowerCase()}-${timestamp}`;
  const pvcName = `${device.id.toLowerCase()}-pvc`; // Keep PVC name stable
  
  const memory = device.memory ? device.memory.replace(/Gi|GB/i, 'G') : (device.type === 'vm' ? '2G' : '1G');
  const cpu = device.cpu ? parseInt(device.cpu.match(/\d+/)[0]) || 1 : (device.type === 'router' ? 2 : 1);
  const assignments = ipAssignments.get(device.id) || [];
  
  // Generate network interfaces and networks based on connections
  const interfaces = ['          - name: default\n            masquerade: {}'];
  const networks = ['      - name: default\n        pod: {}'];
  
  assignments.forEach((assignment, index) => {
    const interfaceName = `net${index + 1}`;
    interfaces.push(`          - name: ${interfaceName}\n            bridge: {}`);
    networks.push(`      - name: ${interfaceName}\n        multus:\n          networkName: ${assignment.network}`);
  });
  
  // Generate cloud-init configuration with cache-busting
  const cloudInit = generateCloudInitForDevice(device, assignments);
  
  // Check size (for debugging)
  const cloudInitSize = Buffer.byteLength(cloudInit, 'utf8');
  console.log(`📏 Cloud-init size for ${device.id}: ${cloudInitSize} bytes (limit: 2048)`);
  
  if (cloudInitSize > 2048) {
    console.error(`❌ Cloud-init too large for ${device.id}: ${cloudInitSize} bytes`);
  }
  
  return `# ${device.type.toUpperCase()}: ${device.id} with Network Configuration (${timestamp})
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${deviceName}
  labels:
    kubevirt.io/os: linux
    device-type: ${device.type}
    device-id: ${device.id}
    deployment-version: "${timestamp}"
spec:
  runStrategy: Always
  template:
    metadata:
      labels:
        deployment-id: "${timestamp}"
    spec:
      domain:
        cpu:
          cores: ${cpu}
        devices:
          disks:
          - disk:
              bus: virtio
            name: disk0
          - cdrom:
              bus: sata
              readonly: true
            name: cloudinitdisk
          interfaces:
${interfaces.join('\n')}
        machine:
          type: q35
        resources:
          requests:
            memory: ${memory}
      networks:
${networks.join('\n')}
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${pvcName}
      - cloudInitNoCloud:
          userData: |
            ${cloudInit.split('\n').join('\n            ')}
        name: cloudinitdisk`;
}

// Generate cloud-init configuration based on device type (with cache-busting)
function generateCloudInitForDevice(device, assignments) {
  // Add a unique timestamp to force cloud-init to treat this as a new instance
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const deploymentId = `${device.id.toLowerCase()}-${timestamp}`;
  
  let config = `#cloud-config
# Deployment ID: ${deploymentId}
# Generated: ${timestamp}
hostname: ${device.id.toLowerCase()}
ssh_pwauth: true
disable_root: false
chpasswd:
  list: |
    root:pass123
    debian:pass123
  expire: false`;

  // Configure all network interfaces for devices with multiple networks
  if (assignments.length > 0) {
    config += `
write_files:
- path: /tmp/net-${device.id.toLowerCase()}.sh
  permissions: '0755'
  content: |
    #!/bin/bash
    echo "Network setup started for ${device.id} at $(date)"
    dhclient enp1s0`;
    
    // Configure each network interface
    assignments.forEach((assignment, index) => {
      const originalInterface = `enp${index + 2}s0`;  // enp2s0, enp3s0, etc.
      const newName = assignment.network;
      const ip = assignment.ip;
      
      config += `
    echo "Configuring ${originalInterface} -> ${newName} (${ip})"
    ip link set ${originalInterface} name ${newName}
    ip addr add ${ip}/24 dev ${newName}
    ip link set ${newName} up`;
    });
    
    // Add device-specific configuration
    if (device.type === 'vm' && assignments.length > 0) {
      config += `
    echo "Adding default route via ${assignments[0].gateway}"
    ip route add default via ${assignments[0].gateway}`;
    }
    
    if (device.type === 'router') {
      config += `
    echo "Enabling IP forwarding"
    echo 1 > /proc/sys/net/ipv4/ip_forward`;
    }
    
    config += `
    echo "Network setup completed for ${device.id} at $(date)"
    echo "Final network status:"
    ip addr show
runcmd:
- /tmp/net-${device.id.toLowerCase()}.sh`;
  } else {
    config += `
runcmd:
- dhclient enp1s0
- echo "Basic network setup completed for ${device.id}"`;
  }

  return config;
}

// Helper function to normalize storage quantity
function normalizeStorageQuantity(storage) {
  if (!storage) return '10Gi';
  const cleaned = storage.toString().trim().replace(/\s+/g, '');
  
  return cleaned
    .replace(/(\d+)GB?$/i, '$1Gi')
    .replace(/(\d+)MB?$/i, '$1Mi')
    .replace(/(\d+)TB?$/i, '$1Ti')
    .replace(/(\d+)G$/i, '$1Gi')
    .replace(/(\d+)M$/i, '$1Mi')
    .replace(/(\d+)T$/i, '$1Ti') || '10Gi';
}

// Network topology analysis endpoint
app.get('/network-topology', (req, res) => {
  console.log(`🌐 Analyzing KubeVirt network topology (mode: ${currentNetworkMode})...`);
  try {
    const { ipAssignments, networkSegments } = generateKubeVirtIPAssignments();
    
    const topology = {
      networkMode: currentNetworkMode,
      devices: devices.map(device => ({
        ...device,
        networks: ipAssignments.get(device.id) || []
      })),
      networkSegments: Object.fromEntries(networkSegments),
      connections: connections
    };
    
    console.log('✅ KubeVirt topology analysis complete');
    res.json({ topology });
  } catch (error) {
    console.error('❌ Error analyzing topology:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('💥 Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

// 404 handler
app.use('*', (req, res) => {
  console.log('❓ 404 - Route not found:', req.method, req.originalUrl);
  res.status(404).json({ 
    error: 'Route not found',
    method: req.method,
    path: req.originalUrl
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('🚀 KubeVirt Infrastructure Designer Backend starting...');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log('🎮 KubeVirt-native networking enabled');
  console.log('🔍 Test the server: curl http://localhost:4000/health');
});