const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();

// Configuration
const NAMESPACE = 'infrastructure-lab'; // Configurable namespace for all resources

app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000'],
  credentials: true
}));

app.use(bodyParser.json());

let devices = [];
let connections = [];

app.get('/', (req, res) => {
  res.json({ 
    message: 'Infrastructure Designer Backend',
    endpoints: [
      'GET /health - Health check',
      'GET /clear-database - Clear all data',
      'POST /devices - Create device',
      'GET /devices - List devices',
      'POST /devices/delete - Delete device',
      'POST /connections - Create connection',
      'GET /connections - List connections',
      'GET /export/kubevirt - Export complete infrastructure',
      'GET /export/kubevirt-pvcs - Export PVCs only',
      'GET /export/kubevirt-vms - Export VMs only'
    ]
  });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy',
    devices: devices.length,
    connections: connections.length
  });
});

app.get('/clear-database', (req, res) => {
  devices = [];
  connections = [];
  res.json({ message: 'Database cleared' });
});

app.post('/devices', (req, res) => {
  const { id, type, cpu, memory, storage, ip, interfaceIPs } = req.body;
  
  try {
    const existingDevice = devices.find(d => d.id === id);
    if (existingDevice) {
      return res.status(400).json({ error: `Device with ID ${id} already exists` });
    }

    let processedIP = null;
    if (ip && ip.trim()) {
      processedIP = ip.trim();
      const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      const match = processedIP.match(ipPattern);
      if (!match) {
        return res.status(400).json({ error: `Invalid IP address format: ${processedIP}` });
      }
      
      const octets = match.slice(1, 5).map(Number);
      if (octets.some(octet => octet > 255)) {
        return res.status(400).json({ error: `Invalid IP address - octets must be 0-255: ${processedIP}` });
      }
      
      const existingIP = devices.find(d => d.ip === processedIP);
      if (existingIP) {
        return res.status(400).json({ error: `IP address ${processedIP} is already assigned to device ${existingIP.id}` });
      }
    }

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
    res.json({ success: true, device });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/devices', (req, res) => {
  res.json(devices);
});

app.post('/devices/delete', (req, res) => {
  const { deviceId } = req.body;
  
  try {
    devices = devices.filter(device => device.id !== deviceId);
    connections = connections.filter(
      conn => conn.from !== deviceId && conn.to !== deviceId
    );
    
    res.json({ 
      success: true, 
      message: `Device ${deviceId} deleted`
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/connections', (req, res) => {
  const { from, to, fromRouterIP, toRouterIP } = req.body;
  
  try {
    const fromDevice = devices.find(d => d.id === from);
    const toDevice = devices.find(d => d.id === to);
    
    if (!fromDevice || !toDevice) {
      return res.status(404).json({ error: 'One or both devices not found.' });
    }

    if (fromDevice.type === 'vm' && toDevice.type === 'vm') {
      return res.status(400).json({ error: 'Connecting VM with VM is prohibited.' });
    }

    const existingConnection = connections.find(
      c => (c.from === from && c.to === to) || (c.from === to && c.to === from)
    );
    if (existingConnection) {
      return res.status(400).json({ error: 'Connection already exists between these devices' });
    }

    const newConnection = {
      from,
      to,
      fromRouterIP: fromRouterIP || null,
      toRouterIP: toRouterIP || null,
      createdAt: new Date().toISOString()
    };
    
    connections.push(newConnection);
    
    if (fromRouterIP && fromDevice.type === 'router') {
      if (!fromDevice.interfaceIPs) fromDevice.interfaceIPs = {};
      fromDevice.interfaceIPs[`to_${to}`] = fromRouterIP;
    }
    
    if (toRouterIP && toDevice.type === 'router') {
      if (!toDevice.interfaceIPs) toDevice.interfaceIPs = {};
      toDevice.interfaceIPs[`to_${from}`] = toRouterIP;
    }
    
    res.json({ success: true, connection: newConnection });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/connections', (req, res) => {
  try {
    const formattedConnections = connections.map(conn => ({
      from: conn.from,
      to: conn.to
    }));
    res.json(formattedConnections);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// KubeVirt Export Endpoints
app.get('/export/kubevirt', (req, res) => {
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generateKubeVirtInfrastructure(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure.yaml"');
    res.send(kubevirtYaml);
  } catch (error) {
    res.status(500).json({ error: `Failed to export KubeVirt configuration: ${error.message}` });
  }
});

app.get('/export/kubevirt-pvcs', (req, res) => {
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generatePVCsOnly(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure-pvcs.yaml"');
    res.send(kubevirtYaml);
  } catch (error) {
    res.status(500).json({ error: `Failed to export KubeVirt PVCs: ${error.message}` });
  }
});

app.get('/export/kubevirt-vms', (req, res) => {
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const kubevirtYaml = generateVMsOnly(devices, connections);
    
    res.setHeader('Content-Type', 'application/x-yaml');
    res.setHeader('Content-Disposition', 'attachment; filename="kubevirt-infrastructure-vms.yaml"');
    res.send(kubevirtYaml);
  } catch (error) {
    res.status(500).json({ error: `Failed to export KubeVirt VMs: ${error.message}` });
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: 'Internal server error' });
});

app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});

function analyzeConnectionBasedTopology() {
  const networkSegments = new Map();
  const deviceNetworks = new Map();
  
  let segmentCounter = 1;
  const processedConnections = new Set();
  
  devices.forEach(device => {
    deviceNetworks.set(device.id, []);
  });
  
  connections.forEach(connItem => {
    const connectionKey = `${connItem.from}-${connItem.to}`;
    const reverseKey = `${connItem.to}-${connItem.from}`;
    
    if (!processedConnections.has(connectionKey) && !processedConnections.has(reverseKey)) {
      const segmentName = `net${segmentCounter}`;
      
      const connectionIPs = [];
      
      if (connItem.fromRouterIP) connectionIPs.push(connItem.fromRouterIP);
      if (connItem.toRouterIP) connectionIPs.push(connItem.toRouterIP);
      
      const fromDevice = devices.find(d => d.id === connItem.from);
      const toDevice = devices.find(d => d.id === connItem.to);
      
      if (fromDevice && fromDevice.ip) connectionIPs.push(fromDevice.ip);
      if (toDevice && toDevice.ip) connectionIPs.push(toDevice.ip);
      
      let subnet = `192.168.${segmentCounter}.0/24`;
      let networkBase = `192.168.${segmentCounter}`;
      let detectedIP = null;
      
      if (connectionIPs.length > 0) {
        detectedIP = connectionIPs[0];
        const ipParts = detectedIP.split('.');
        if (ipParts.length === 4 && ipParts.every(part => !isNaN(part) && part >= 0 && part <= 255)) {
          networkBase = `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}`;
          subnet = `${networkBase}.0/24`;
        }
      }
      
      networkSegments.set(segmentName, {
        name: segmentName,
        subnet: subnet,
        networkBase: networkBase,
        devices: [connItem.from, connItem.to],
        connectionId: `${connItem.from}-${connItem.to}`,
        detectedFromIP: detectedIP,
        allConnectionIPs: connectionIPs
      });
      
      deviceNetworks.get(connItem.from).push(segmentName);
      deviceNetworks.get(connItem.to).push(segmentName);
      
      processedConnections.add(connectionKey);
      processedConnections.add(reverseKey);
      segmentCounter++;
    }
  });
  
  return { networkSegments, deviceNetworks };
}

function generateConnectionBasedIPAssignments() {
  const { networkSegments, deviceNetworks } = analyzeConnectionBasedTopology();
  const ipAssignments = new Map();
  
  devices.forEach(device => {
    const assignments = [];
    const deviceNetworkList = deviceNetworks.get(device.id) || [];
    
    deviceNetworkList.forEach((networkName, index) => {
      const segment = networkSegments.get(networkName);
      if (segment) {
        const baseNetwork = segment.networkBase || `192.168.${networkName.replace('net', '')}`;
        
        let ip;
        let isCustomIP = false;
        
        const segmentConn = connections.find(conn => 
          (conn.from === segment.devices[0] && conn.to === segment.devices[1]) ||
          (conn.from === segment.devices[1] && conn.to === segment.devices[0])
        );
        
        if (device.type === 'router') {
          if (segmentConn) {
            if (segmentConn.from === device.id && segmentConn.fromRouterIP) {
              ip = segmentConn.fromRouterIP;
              isCustomIP = true;
            } else if (segmentConn.to === device.id && segmentConn.toRouterIP) {
              ip = segmentConn.toRouterIP;
              isCustomIP = true;
            }
          }
          
          if (!ip && device.interfaceIPs) {
            const otherDeviceId = segment.devices.find(d => d !== device.id);
            const interfaceKey = `to_${otherDeviceId}`;
            if (device.interfaceIPs[interfaceKey]) {
              ip = device.interfaceIPs[interfaceKey];
              isCustomIP = true;
            }
          }
          
          if (!ip) {
            ip = `${baseNetwork}.1`;
          }
        } else {
          if (index === 0 && device.ip && device.ip.trim()) {
            ip = device.ip.trim();
            isCustomIP = true;
          } else {
            // VM gets .10 if connected to router, .11 otherwise
            const otherDeviceId = segment.devices.find(d => d !== device.id);
            const otherDevice = devices.find(d => d.id === otherDeviceId);
            if (otherDevice && otherDevice.type === 'router') {
              ip = `${baseNetwork}.10`;
            } else {
              ip = `${baseNetwork}.11`;
            }
          }
        }
        
        let gatewayIP = `${baseNetwork}.1`;
        
        if (segmentConn) {
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
          interfaceName: `eth${index + 1}`,
          isCustomIP: isCustomIP,
          connectionId: segment.connectionId
        });
      }
    });
    
    ipAssignments.set(device.id, assignments);
  });
  
  return { ipAssignments, networkSegments };
}

function generateKubeVirtInfrastructure(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateConnectionBasedIPAssignments();
  
  components.push(`# KubeVirt Infrastructure
# Generated: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
# Namespace: ${NAMESPACE}

# Create namespace first
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    name: ${NAMESPACE}
    type: infrastructure-lab`);

  components.push(generateNetworkAttachmentDefinitions(networkSegments));
  
  components.push('# Persistent Volume Claims');
  devices.forEach(device => {
    components.push(generateDevicePVC(device));
  });
  
  components.push('# Virtual Machines');
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

function generateVMsOnly(devices, connections) {
  const components = [];
  const { ipAssignments, networkSegments } = generateConnectionBasedIPAssignments();
  
  components.push(`# KubeVirt VMs
# Generated: ${new Date().toISOString()}
# Namespace: ${NAMESPACE}`);
  
  components.push('# Virtual Machines');
  devices.forEach(device => {
    components.push(generateNetworkedKubeVirtVM(device, ipAssignments, networkSegments));
  });
  
  return components.join('\n---\n');
}

function generatePVCsOnly(devices, connections) {
  const components = [];
  const { networkSegments } = analyzeConnectionBasedTopology();
  
  components.push(`# KubeVirt PVCs and Networks
# Generated: ${new Date().toISOString()}
# Namespace: ${NAMESPACE}

# Create namespace first
apiVersion: v1
kind: Namespace
metadata:
  name: ${NAMESPACE}
  labels:
    name: ${NAMESPACE}
    type: infrastructure-lab`);
  
  components.push(generateNetworkAttachmentDefinitions(networkSegments));
  
  components.push('# Persistent Volume Claims');
  devices.for