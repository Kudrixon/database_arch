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
let currentNetworkMode = 'connection-based';

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
  const { id, type, cpu, memory, storage, ip, interfaceIPs } = req.body;
  
  try {
    // Check if device already exists
    const existingDevice = devices.find(d => d.id === id);
    if (existingDevice) {
      return res.status(400).json({ error: `Device with ID ${id} already exists` });
    }

    // Validate and process IP address if provided
    let processedIP = null;
    if (ip && ip.trim()) {
      processedIP = ip.trim();
      
      // Basic IP validation
      const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = processedIP.match(ipPattern);
      if (!match) {
        return res.status(400).json({ error: `Invalid IP address format: ${processedIP}` });
      }
      
      // Check if each octet is valid (0-255)
      const octets = match.slice(1, 5).map(Number);
      if (octets.some(octet => octet > 255)) {
        return res.status(400).json({ error: `Invalid IP address - octets must be 0-255: ${processedIP}` });
      }
      
      // Check if IP is already assigned
      const existingIP = devices.find(d => d.ip === processedIP);
      if (existingIP) {
        return res.status(400).json({ error: `IP address ${processedIP} is already assigned to device ${existingIP.id}` });
      }
      
      console.log(`✅ Custom IP validated for ${id}: ${processedIP}`);
    }

    // Validate router interface IPs if provided
    let processedInterfaceIPs = null;
    if (type === 'router' && interfaceIPs) {
      processedInterfaceIPs = {};
      for (const [interfaceKey, interfaceIP] of Object.entries(interfaceIPs)) {
        if (interfaceIP && interfaceIP.trim()) {
          const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
          if (!ipPattern.test(interfaceIP.trim())) {
            return res.status(400).json({ error: `Invalid interface IP format for ${interfaceKey}: ${interfaceIP}` });
          }
          processedInterfaceIPs[interfaceKey] = interfaceIP.trim();
        }
      }
      console.log(`✅ Router interface IPs validated for ${id}:`, processedInterfaceIPs);
    }

    const device = { 
      id, 
      type, 
      cpu, 
      memory, 
      storage, 
      ip: processedIP,
      interfaceIPs: processedInterfaceIPs,
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
      conn => conn.from !== deviceId && conn.to !== deviceId
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
  const { from, to, speed, fromRouterIP, toRouterIP } = req.body;
  console.log('🔗 Creating connection:', { from, to, speed, fromRouterIP, toRouterIP });
  
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
    
    // Create connection with router interface IPs
    const newConnection = {
      from,
      to,
      speed: speedMbps,
      unit,
      originalSpeed: speed,
      fromRouterIP: fromRouterIP || null,
      toRouterIP: toRouterIP || null,
      createdAt: new Date().toISOString()
    };
    
    connections.push(newConnection);
    console.log('✅ Connection created with router IPs:', newConnection);
    
    // Update router devices with interface IPs in the backend
    if (fromRouterIP && fromDevice.type === 'router') {
      if (!fromDevice.interfaceIPs) fromDevice.interfaceIPs = {};
      fromDevice.interfaceIPs[`to_${to}`] = fromRouterIP;
      console.log(`📍 Router ${from} interface to ${to}: ${fromRouterIP}`);
    }
    
    if (toRouterIP && toDevice.type === 'router') {
      if (!toDevice.interfaceIPs) toDevice.interfaceIPs = {};
      toDevice.interfaceIPs[`to_${from}`] = toRouterIP;
      console.log(`📍 Router ${to} interface to ${from}: ${toRouterIP}`);
    }
    
    res.json({ success: true, connection: newConnection });
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

// Fully Dynamic Network Topology Analysis based on Frontend IPs
function analyzeConnectionBasedTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  let segmentCounter = 1;
  const processedConnections = new Set();
  
  // Initialize all devices with empty network arrays
  devices.forEach(device => {
    deviceNetworks.set(device.id, []);
  });
  
  connections.forEach(connItem => {
    const connectionKey = `${connItem.from}-${connItem.to}`;
    const reverseKey = `${connItem.to}-${connItem.from}`;
    
    if (!processedConnections.has(connectionKey) && !processedConnections.has(reverseKey)) {
      const segmentName = `net${segmentCounter}`;
      
      // Find all IPs in this connection to determine the subnet dynamically
      const connectionIPs = [];
      
      // Get router interface IP from connection
      if (connItem.fromRouterIP) connectionIPs.push(connItem.fromRouterIP);
      if (connItem.toRouterIP) connectionIPs.push(connItem.toRouterIP);
      
      // Get device IPs
      const fromDevice = devices.find(d => d.id === connItem.from);
      const toDevice = devices.find(d => d.id === connItem.to);
      
      if (fromDevice && fromDevice.ip) connectionIPs.push(fromDevice.ip);
      if (toDevice && toDevice.ip) connectionIPs.push(toDevice.ip);
      
      // Derive subnet from the first valid IP we find
      let subnet = `192.168.${segmentCounter}.0/24`; // Fallback
      let networkBase = `192.168.${segmentCounter}`;
      let detectedIP = null;
      
      if (connectionIPs.length > 0) {
        // Use the first IP to derive the subnet
        detectedIP = connectionIPs[0];
        const ipParts = detectedIP.split('.');
        if (ipParts.length === 4 && ipParts.every(part => !isNaN(part) && part >= 0 && part <= 255)) {
          networkBase = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
          subnet = `${networkBase}.0/24`;
          console.log(`📍 Derived subnet ${subnet} from IP ${detectedIP} in connection ${connItem.from}-${connItem.to}`);
        }
      }
      
      // Validate that all IPs in this connection are in the same subnet
      const validIPs = connectionIPs.filter(ip => {
        const ipParts = ip.split('.');
        const ipNetworkBase = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
        return ipNetworkBase === networkBase;
      });
      
      if (validIPs.length !== connectionIPs.length && connectionIPs.length > 0) {
        console.warn(`⚠️ Warning: Not all IPs in connection ${connItem.from}-${connItem.to} are in the same subnet!`);
        console.warn(`   Expected subnet: ${networkBase}.0/24`);
        console.warn(`   IPs found: ${connectionIPs.join(', ')}`);
      }
      
      networkSegments.set(segmentName, {
        name: segmentName,
        subnet: subnet,
        networkBase: networkBase,
        devices: [connItem.from, connItem.to],
        speed: connItem.originalSpeed,
        connectionId: `${connItem.from}-${connItem.to}`,
        detectedFromIP: detectedIP,
        allConnectionIPs: connectionIPs
      });
      
      // Add this network to both devices
      deviceNetworks.get(connItem.from).push(segmentName);
      deviceNetworks.get(connItem.to).push(segmentName);
      
      processedConnections.add(connectionKey);
      processedConnections.add(reverseKey);
      segmentCounter++;
    }
  });
  
  console.log('🌐 Dynamic network topology analysis:');
  console.log('Network segments:', networkSegments.size);
  networkSegments.forEach((segment, name) => {
    console.log(`  ${name}: ${segment.subnet} (${segment.devices.join(' <-> ')}) [Detected from: ${segment.detectedFromIP || 'auto'}]`);
    if (segment.allConnectionIPs.length > 0) {
      console.log(`    All IPs: ${segment.allConnectionIPs.join(', ')}`);
    }
  });
  
  deviceNetworks.forEach((networks, deviceId) => {
    console.log(`  ${deviceId}: ${networks.length} network(s) - ${networks.join(', ')}`);
  });
  
  return { networkSegments, deviceNetworks };
}

// Generate IP assignments using dynamic network subnets
function generateConnectionBasedIPAssignments() {
  const { networkSegments, deviceNetworks } = analyzeConnectionBasedTopology();
  const ipAssignments = new Map();
  
  devices.forEach(device => {
    const assignments = [];
    const deviceNetworkList = deviceNetworks.get(device.id) || [];
    
    deviceNetworkList.forEach((networkName, index) => {
      const segment = networkSegments.get(networkName);
      if (segment) {
        // Use the actual network base from the segment (derived from actual IPs)
        const baseNetwork = segment.networkBase || `192.168.${networkName.replace('net', '')}`;
        
        let ip;
        let isCustomIP = false;
        
        // Find the connection for this network segment
        const segmentConn = connections.find(conn => 
          (conn.from === segment.devices[0] && conn.to === segment.devices[1]) ||
          (conn.from === segment.devices[1] && conn.to === segment.devices[0])
        );
        
        if (device.type === 'router') {
          // PRIORITY 1: Use router interface IP from connection if available
          if (segmentConn) {
            if (segmentConn.from === device.id && segmentConn.fromRouterIP) {
              ip = segmentConn.fromRouterIP;
              isCustomIP = true;
              console.log(`📍 Using router interface IP for ${device.id}: ${ip} (from connection)`);
            } else if (segmentConn.to === device.id && segmentConn.toRouterIP) {
              ip = segmentConn.toRouterIP;
              isCustomIP = true;
              console.log(`📍 Using router interface IP for ${device.id}: ${ip} (to connection)`);
            }
          }
          
          // PRIORITY 2: Check device interfaceIPs object
          if (!ip && device.interfaceIPs) {
            const otherDeviceId = segment.devices.find(d => d !== device.id);
            const interfaceKey = `to_${otherDeviceId}`;
            if (device.interfaceIPs[interfaceKey]) {
              ip = device.interfaceIPs[interfaceKey];
              isCustomIP = true;
              console.log(`📍 Using stored interface IP for ${device.id}: ${ip}`);
            }
          }
          
          // PRIORITY 3: Auto-assign router IP (.1 - gateway)
          if (!ip) {
            ip = `${baseNetwork}.1`;
            console.log(`📍 Auto-assigned router IP for ${device.id}: ${ip}`);
          }
        } else {
          // For VMs and Switches
          // PRIORITY 1: Use custom IP if provided by user (only for first interface)
          if (index === 0 && device.ip && device.ip.trim()) {
            ip = device.ip.trim();
            isCustomIP = true;
            console.log(`📍 Using custom IP for ${device.id}: ${ip}`);
          } else {
            // PRIORITY 2: Auto-assign based on device type
            if (device.type === 'switch') {
              ip = `${baseNetwork}.2`; // Switch gets .2
            } else {
              // VM gets .10 or .11 depending on which side of connection
              const otherDeviceId = segment.devices.find(d => d !== device.id);
              const otherDevice = devices.find(d => d.id === otherDeviceId);
              if (otherDevice && otherDevice.type === 'router') {
                ip = `${baseNetwork}.10`; // VM connected to router gets .10
              } else {
                ip = `${baseNetwork}.11`; // VM connected to switch gets .11
              }
            }
            console.log(`📍 Auto-assigned IP for ${device.id} interface ${index + 1}: ${ip}`);
          }
        }
        
        // Determine gateway IP (use actual router IP in this segment)
        let gatewayIP = `${baseNetwork}.1`; // Default
        
        // Find the actual router IP in this connection
        if (segmentConn) {
          // Check if there's a router with a specific interface IP
          const fromDev = devices.find(d => d.id === segmentConn.from);
          const toDev = devices.find(d => d.id === segmentConn.to);
          
          if (fromDev && fromDev.type === 'router' && segmentConn.fromRouterIP) {
            gatewayIP = segmentConn.fromRouterIP;
          } else if (toDev && toDev.type === 'router' && segmentConn.toRouterIP) {
            gatewayIP = segmentConn.toRouterIP;
          }
        }
        
        assignments.push({
          network: networkName,
          ip: ip,
          subnet: segment.subnet,
          gateway: gatewayIP,
          interfaceName: `eth${index + 1}`, // eth1, eth2, etc.
          isCustomIP: isCustomIP,
          connectionId: segment.connectionId
        });
      }
    });
    
    ipAssignments.set(device.id, assignments);
  });
  
  console.log('📍 IP assignments (with dynamic network subnets):');
  ipAssignments.forEach((assignments, deviceId) => {
    const deviceObj = devices.find(d => d.id === deviceId);
    const customIPNote = deviceObj.ip ? ` (device IP: ${deviceObj.ip})` : '';
    console.log(`  ${deviceId}${customIPNote}: ${assignments.length} interface(s)`);
    assignments.forEach(assignment => {
      const customFlag = assignment.isCustomIP ? ' [CUSTOM]' : ' [AUTO]';
      console.log(`    ${assignment.interfaceName}: ${assignment.ip} on ${assignment.network} (${assignment.subnet})${customFlag}`);
    });
  });
  
  return { ipAssignments, networkSegments };
}

// Generate complete KubeVirt infrastructure with proper networking
function generateKubeVirtInfrastructure(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateConnectionBasedIPAssignments();
  
  components.push(`# KubeVirt Infrastructure with Connection-Based Networking
# Generated: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
#
# NETWORK ARCHITECTURE:
# - Each connection creates a separate network segment
# - Routers get custom IPs per interface (user-defined)
# - Switches get .2 IP on each network
# - VMs get custom IPs where specified
# - Each device gets multiple interfaces for multiple connections
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
  
  // Generate VMs with proper network configuration
  components.push('# ========================================');
  components.push('# Virtual Machines with Multi-Interface Networking');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

function generateVMsOnly(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateConnectionBasedIPAssignments();
  
  components.push(`# KubeVirt VMs with Connection-Based Network Configuration
# Generated: ${new Date().toISOString()}
# 
# IMPORTANT: Apply after PVCs are ready (Status: Succeeded)
# Check with: kubectl get pvc
#
# Each device gets interfaces for all its connections:
# - Routers get custom IPs per interface (user-defined)
# - Switches bridge traffic (.2) on each network segment
# - VMs get custom IPs where specified
#`);
  
  // Generate VMs with network configuration
  components.push('# ========================================');
  components.push('# Virtual Machines with Multi-Interface Setup');
  components.push('# ========================================');
  
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

function generatePVCsOnly(devices, connections) {
  const components = [];
  const { networkSegments } = analyzeConnectionBasedTopology();
  
  components.push(`# KubeVirt PVCs and Network Setup
# Generated: ${new Date().toISOString()}
# 
# Apply this first and wait for CDI import completion
# Network segments: ${networkSegments.size}
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

// Generate NetworkAttachmentDefinitions with correct subnets and proper YAML escaping
function generateNetworkAttachmentDefinitions(networkSegments) {
  const components = ['# Network Attachment Definitions for Device Connections'];
  
  networkSegments.forEach((segment, segmentName) => {
    // Extract network information from the actual subnet
    const subnetParts = segment.subnet.split('/');
    const networkIP = subnetParts[0];
    const networkIPParts = networkIP.split('.');
    const networkOctet = networkIPParts[2]; // Use actual third octet from subnet
    
    // Use descriptive bridge name based on actual network
    const bridgeName = `br${networkOctet}`;
    // Create valid Kubernetes label (no slashes allowed)
    const subnetLabel = segment.subnet.replace(/[/.]/g, '-');
    
    // Calculate IPAM range based on actual subnet
    const networkBase = `${networkIPParts[0]}.${networkIPParts[1]}.${networkIPParts[2]}`;
    const rangeStart = `${networkBase}.10`;
    const rangeEnd = `${networkBase}.200`;
    
    // Escape the connection ID to prevent YAML issues
    const safeConnectionId = (segment.connectionId || 'unknown').replace(/[^\w-]/g, '-');
    
    console.log(`🌐 Creating NetworkAttachmentDefinition ${segmentName}: ${segment.subnet} (bridge: ${bridgeName})`);
    
    components.push(`apiVersion: k8s.cni.cncf.io/v1
kind: NetworkAttachmentDefinition
metadata:
  name: ${segmentName}
  labels:
    network-type: infrastructure-segment
    network-subnet: ${subnetLabel}
    network-octet: "${networkOctet}"
    connection: ${safeConnectionId}
spec:
  config: |
    {
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
        "rangeStart": "${rangeStart}",
        "rangeEnd": "${rangeEnd}"
      }
    }`);
  });
  
  return components.join('\n---\n');
}

// Generate PVC for any device type with proper YAML formatting
function generateDevicePVC(device) {
  const deviceName = device.id.toLowerCase();
  const storage = device.storage ? normalizeStorageQuantity(device.storage) : '10Gi';
  
  return `# PVC for ${device.type.toUpperCase()}: ${device.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${deviceName}-pvc
  labels:
    app: containerized-data-importer
    device-type: ${device.type}
    device-id: ${device.id}
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: ${storage}
  storageClassName: nfs-client`;
}

// Generate networked KubeVirt VM with multiple interfaces
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
    const interfaceName = assignment.network; // Use actual network name instead of generic net1, net2
    interfaces.push(`          - name: ${interfaceName}\n            bridge: {}`);
    networks.push(`      - name: ${interfaceName}\n        multus:\n          networkName: ${assignment.network}`);
  });
  
  // Generate cloud-init configuration with multiple interfaces
  const cloudInit = generateCloudInitForDevice(device, assignments);
  
  // Check size (for debugging)
  const cloudInitSize = Buffer.byteLength(cloudInit, 'utf8');
  console.log(`📏 Cloud-init size for ${device.id}: ${cloudInitSize} bytes (limit: 2048)`);
  
  if (cloudInitSize > 2048) {
    console.error(`❌ Cloud-init too large for ${device.id}: ${cloudInitSize} bytes`);
  }
  
  return `# ${device.type.toUpperCase()}: ${device.id} with Multi-Interface Configuration (${assignments.length} interfaces)
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${deviceName}
  labels:
    kubevirt.io/os: linux
    device-type: ${device.type}
    device-id: ${device.id}
    deployment-version: "${timestamp}"
    interface-count: "${assignments.length}"
spec:
  runStrategy: Always
  template:
    metadata:
      labels:
        deployment-id: "${timestamp}"
        network-interfaces: "${assignments.length}"
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

// Generate ultra-compact cloud-init configuration (under 2048 bytes)
function generateCloudInitForDevice(device, assignments) {
  const ts = Date.now().toString(36).slice(-6); // Short timestamp
  
  let config = `#cloud-config
hostname: ${device.id.toLowerCase()}
ssh_pwauth: true
disable_root: false
chpasswd:
  list: |
    root:pass123
    debian:pass123
  expire: false`;

  if (assignments.length > 0) {
    config += `
write_files:
- path: /tmp/net.sh
  permissions: '0755'
  content: |
    #!/bin/bash
    dhclient enp1s0`;
    
    // Ultra-compact interface configuration
    assignments.forEach((assignment, index) => {
      const iface = `enp${index + 2}s0`;
      const name = `eth${index + 1}`;
      const ip = assignment.ip;
      
      config += `
    ip link set ${iface} name ${name} 2>/dev/null||true
    ip addr add ${ip}/24 dev ${name}
    ip link set ${name} up`;
    });
    
    // Minimal device-specific config
    if (device.type === 'router') {
      config += `
    echo 1>/proc/sys/net/ipv4/ip_forward
    iptables -A FORWARD -j ACCEPT`;
    }
    
    if (device.type === 'vm' && assignments.length > 0) {
      config += `
    ip route del default via 10.0.2.1 dev enp1s0 2>/dev/null||true
    ip route add default via ${assignments[0].gateway} dev eth1 metric 50
    ip route add default via 10.0.2.1 dev enp1s0 metric 100 2>/dev/null||true`;
    }
    
    config += `
runcmd:
- /tmp/net.sh`;
  } else {
    config += `
runcmd:
- dhclient enp1s0`;
  }

  // Check size and truncate if needed
  const size = Buffer.byteLength(config, 'utf8');
  console.log(`📏 Cloud-init size for ${device.id}: ${size} bytes`);
  
  if (size > 2000) { // Leave some buffer
    console.warn(`⚠️ Cloud-init too large for ${device.id}, using minimal config`);
    // Fallback to absolute minimal config
    config = `#cloud-config
hostname: ${device.id.toLowerCase()}
ssh_pwauth: true
chpasswd:
  list: |
    root:pass123
  expire: false
runcmd:
- dhclient enp1s0`;
    
    if (assignments.length > 0) {
      const ip = assignments[0].ip;
      const gateway = assignments[0].gateway;
      config += `
- ip addr add ${ip}/24 dev enp2s0
- ip link set enp2s0 up
- ip route add default via ${gateway} dev enp2s0`;
    }
  }

  return config;
}

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

// Network topology analysis endpoint
app.get('/network-topology', (req, res) => {
  console.log(`🌐 Analyzing KubeVirt network topology (mode: ${currentNetworkMode})...`);
  try {
    const { ipAssignments, networkSegments } = generateConnectionBasedIPAssignments();
    
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
  console.log('🔍 Network Mode: Connection-Based (each connection = separate network)');
  console.log('🎮 Multi-interface networking enabled');
  console.log('🌐 Router interface IP support enabled');
  console.log('🔍 Test the server: curl http://localhost:4000/health');
});