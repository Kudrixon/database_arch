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

// Test endpoint to verify server is working
app.get('/', (req, res) => {
  res.json({ 
    message: 'Infrastructure Designer Backend is running!',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET / - This message',
      'GET /health - Health check',
      'GET /clear-database - Clear all data',
      'POST /devices - Create device',
      'GET /devices - List devices',
      'POST /devices/delete - Delete device',
      'POST /connections - Create connection',
      'GET /connections - List connections',
      'GET /export/kubevirt - Export to KubeVirt YAML'
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
  const { id, type, cpu, memory, storage } = req.body;
  
  try {
    // Check if device already exists
    const existingDevice = devices.find(d => d.id === id);
    if (existingDevice) {
      return res.status(400).json({ error: `Device with ID ${id} already exists` });
    }

    const device = { id, type, cpu, memory, storage, createdAt: new Date().toISOString() };
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

// KubeVirt Export Endpoint
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

// Network topology analysis
app.get('/network-topology', (req, res) => {
  console.log('🌐 Analyzing network topology...');
  try {
    const topology = devices.map(device => {
      const deviceConnections = connections.filter(
        c => c.from === device.id || c.to === device.id
      );
      
      return {
        device,
        connections: deviceConnections,
        connectedDevices: deviceConnections.map(c => 
          c.from === device.id ? devices.find(d => d.id === c.to) : devices.find(d => d.id === c.from)
        ).filter(Boolean)
      };
    });
    
    console.log('✅ Topology analysis complete');
    res.json({ topology });
  } catch (error) {
    console.error('❌ Error analyzing topology:', error);
    res.status(500).json({ error: error.message });
  }
});

// KubeVirt YAML Generation Functions
function generateKubeVirtInfrastructure(devices, connections) {
  const components = [];
  
  // Add header comment
  components.push(`# KubeVirt Infrastructure Configuration
# Generated from Infrastructure Designer
# Date: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
#
# This configuration includes:
# - Network Attachments for different network segments
# - Virtual Machines with proper networking
# - Router and Switch configurations
# - All necessary PVCs for VM storage
#`);
  
  // Generate network attachments first
  components.push(generateNetworkAttachments());
  
  // Generate configurations for each device type
  const routers = devices.filter(d => d.type === 'router');
  const switches = devices.filter(d => d.type === 'switch');
  const vms = devices.filter(d => d.type === 'vm');
  
  console.log(`📊 Generating: ${routers.length} routers, ${switches.length} switches, ${vms.length} VMs`);
  
  // Routers first (they provide network services)
  routers.forEach(router => {
    components.push(generateRouterInfrastructure(router));
  });
  
  // Then switches (they provide L2 connectivity)
  switches.forEach(switch_ => {
    components.push(generateSwitchInfrastructure(switch_));
  });
  
  // Finally VMs (they consume network services)
  vms.forEach(vm => {
    components.push(generateVMInfrastructure(vm));
  });
  
  return components.join('\n---\n');
}

function generateNetworkAttachments() {
  return `# Network Attachments for Infrastructure
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: lan-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "lan-network",
    "type": "bridge",
    "bridge": "lan-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "192.168.1.0/24",
      "rangeStart": "192.168.1.10",
      "rangeEnd": "192.168.1.100"
    }
  }'

---
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: wan-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "wan-network",
    "type": "bridge",
    "bridge": "wan-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "10.0.0.0/24",
      "rangeStart": "10.0.0.10",
      "rangeEnd": "10.0.0.100"
    }
  }'

---
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: dmz-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "dmz-network",
    "type": "bridge",
    "bridge": "dmz-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "172.16.1.0/24",
      "rangeStart": "172.16.1.10",
      "rangeEnd": "172.16.1.100"
    }
  }'

---
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: vlan10-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "vlan10-network",
    "type": "bridge",
    "bridge": "vlan10-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "192.168.10.0/24",
      "rangeStart": "192.168.10.10",
      "rangeEnd": "192.168.10.100"
    }
  }'

---
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: vlan20-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "vlan20-network",
    "type": "bridge",
    "bridge": "vlan20-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "192.168.20.0/24",
      "rangeStart": "192.168.20.10",
      "rangeEnd": "192.168.20.100"
    }
  }'

---
apiVersion: "k8s.cni.cncf.io/v1"
kind: NetworkAttachmentDefinition
metadata:
  name: vlan30-network
spec:
  config: '{
    "cniVersion": "0.3.1",
    "name": "vlan30-network",
    "type": "bridge",
    "bridge": "vlan30-br",
    "isGateway": false,
    "ipMasq": false,
    "ipam": {
      "type": "host-local",
      "subnet": "192.168.30.0/24",
      "rangeStart": "192.168.30.10",
      "rangeEnd": "192.168.30.100"
    }
  }'`;
}

// Exact replica of your working debian12 VM
function generateVMInfrastructure(vm) {
  const vmName = vm.id.toLowerCase();
  const memory = vm.memory ? vm.memory.replace(/Gi|GB/i, 'G') : '2G';
  const cpu = vm.cpu ? parseInt(vm.cpu.match(/\d+/)[0]) || 2 : 2;
  const storage = normalizeStorageQuantity(vm.storage);
  
  console.log(`📝 VM ${vm.id}: memory=${memory}, cpu=${cpu}, storage=${storage}`);
  
  return `# VM: ${vm.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${vmName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: ${storage}
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${vmName}
  labels:
    kubevirt.io/os: linux
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
        machine:
          type: q35
        resources:
          requests:
            memory: ${memory}
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${vmName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${vmName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:myrootpassword
                debian:userpassword
              expire: False
        name: cloudinitdisk`;
}

function generateRouterInfrastructure(router) {
  const routerName = router.id.toLowerCase();
  
  return `# Router: ${router.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${routerName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${routerName}
  labels:
    kubevirt.io/os: linux
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 2
        devices:
          disks:
          - disk:
              bus: virtio
            name: disk0
          - cdrom:
              bus: sata
              readonly: true
            name: cloudinitdisk
        machine:
          type: q35
        resources:
          requests:
            memory: 4G
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${routerName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${routerName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:myrootpassword
                debian:userpassword
              expire: False
            package_update: true
            packages:
              - frr
              - iptables-persistent
              - dnsmasq
            runcmd:
              - echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
              - sysctl -p
        name: cloudinitdisk`;
}

function generateSwitchInfrastructure(switch_) {
  const switchName = switch_.id.toLowerCase();
  
  return `# Switch: ${switch_.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${switchName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 15Gi
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${switchName}
  labels:
    kubevirt.io/os: linux
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 2
        devices:
          disks:
          - disk:
              bus: virtio
            name: disk0
          - cdrom:
              bus: sata
              readonly: true
            name: cloudinitdisk
        machine:
          type: q35
        resources:
          requests:
            memory: 4G
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${switchName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${switchName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:myrootpassword
                debian:userpassword
              expire: False
            package_update: true
            packages:
              - openvswitch-switch
            runcmd:
              - systemctl enable openvswitch-switch
              - systemctl start openvswitch-switch
        name: cloudinitdisk`;
}

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

function generateRouterInfrastructure(router) {
  const routerName = router.id.toLowerCase();
  
  return `# Router: ${router.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${routerName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 6Gi
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${routerName}
  labels:
    app: ${routerName}
spec:
  runStrategy: Always
  template:
    metadata:
      labels:
        kubevirt.io/vm: ${routerName}
    spec:
      domain:
        devices:
          disks:
          - name: containerdisk
            disk:
              bus: virtio
          - name: cloudinitdisk
            disk:
              bus: virtio
          interfaces:
          - name: default
            masquerade: {}
          - name: lan
            bridge: {}
          - name: wan
            bridge: {}
          - name: dmz
            bridge: {}
        machine:
          type: pc-q35-rhel8.6.0
        resources:
          requests:
            memory: 2Gi
            cpu: 1
      networks:
      - name: default
        pod: {}
      - name: lan
        multus:
          networkName: lan-network
      - name: wan
        multus:
          networkName: wan-network
      - name: dmz
        multus:
          networkName: dmz-network
      volumes:
      - name: containerdisk
        persistentVolumeClaim:
          claimName: ${routerName}-pvc
      - name: cloudinitdisk
        cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${routerName}
            users:
              - name: ubuntu
                sudo: ALL=(ALL) NOPASSWD:ALL
                shell: /bin/bash
            package_update: true
            packages:
              - frr
              - iptables-persistent
              - dnsmasq`;
}



function generateRouterInfrastructure(router) {
  const routerName = router.id.toLowerCase();
  
  return `# Router: ${router.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${routerName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 20Gi
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${routerName}
  labels:
    kubevirt.io/os: linux
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 2
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
          - name: lan
            bridge: {}
          - name: wan
            bridge: {}
          - name: dmz
            bridge: {}
        machine:
          type: q35
        resources:
          requests:
            memory: 4Gi
      networks:
      - name: default
        pod: {}
      - name: lan
        multus:
          networkName: lan-network
      - name: wan
        multus:
          networkName: wan-network
      - name: dmz
        multus:
          networkName: dmz-network
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${routerName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${routerName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:rootpassword
                ubuntu:ubuntu
              expire: False
            users:
              - name: ubuntu
                sudo: ALL=(ALL) NOPASSWD:ALL
                shell: /bin/bash
            package_update: true
            packages:
              - frr
              - iptables-persistent
              - dnsmasq
              - net-tools
              - openssh-server
            runcmd:
              - echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf
              - sysctl -p
              - systemctl enable ssh
              - systemctl start ssh
        name: cloudinitdisk`;
}

function generateSwitchInfrastructure(switch_) {
  const switchName = switch_.id.toLowerCase();
  
  return `# Switch: ${switch_.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${switchName}-pvc"
  labels:
    app: containerized-data-importer
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 15Gi
  storageClassName: nfs-client

---
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${switchName}
  labels:
    kubevirt.io/os: linux
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 2
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
          - name: uplink
            bridge: {}
          - name: port1
            bridge: {}
          - name: port2
            bridge: {}
        machine:
          type: q35
        resources:
          requests:
            memory: 4Gi
      networks:
      - name: default
        pod: {}
      - name: uplink
        multus:
          networkName: lan-network
      - name: port1
        multus:
          networkName: vlan10-network
      - name: port2
        multus:
          networkName: vlan20-network
      volumes:
      - name: disk0
        persistentVolumeClaim:
          claimName: ${switchName}-pvc
      - cloudInitNoCloud:
          userData: |
            #cloud-config
            hostname: ${switchName}
            ssh_pwauth: true
            disable_root: false
            chpasswd:
              list: |
                root:rootpassword
                ubuntu:ubuntu
              expire: False
            users:
              - name: ubuntu
                sudo: ALL=(ALL) NOPASSWD:ALL
                shell: /bin/bash
            package_update: true
            packages:
              - openvswitch-switch
              - openvswitch-common
              - bridge-utils
              - net-tools
              - openssh-server
            runcmd:
              - systemctl enable openvswitch-switch
              - systemctl start openvswitch-switch
              - systemctl enable ssh
              - systemctl start ssh
        name: cloudinitdisk`;
}

// Keep the storage normalization functions
function normalizeStorageQuantity(storage) {
  if (!storage) return '20Gi';
  const cleaned = storage.toString().trim().replace(/\s+/g, '');
  
  // Convert common formats to Kubernetes format
  return cleaned
    .replace(/(\d+)GB?$/i, '$1Gi')
    .replace(/(\d+)MB?$/i, '$1Mi')
    .replace(/(\d+)TB?$/i, '$1Ti')
    .replace(/(\d+)G$/i, '$1Gi')
    .replace(/(\d+)M$/i, '$1Mi')
    .replace(/(\d+)T$/i, '$1Ti') || '20Gi';
}

function normalizeMemoryQuantity(memory) {
  if (!memory) return '4Gi';
  const cleaned = memory.toString().trim().replace(/\s+/g, '');
  
  // Convert common formats to Kubernetes format
  return cleaned
    .replace(/(\d+)GB?$/i, '$1Gi')
    .replace(/(\d+)MB?$/i, '$1Mi')
    .replace(/(\d+)TB?$/i, '$1Ti')
    .replace(/(\d+)G$/i, '$1Gi')
    .replace(/(\d+)M$/i, '$1Mi')
    .replace(/(\d+)T$/i, '$1Ti') || '4Gi';
}

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
    path: req.originalUrl,
    availableEndpoints: [
      'GET /',
      'GET /health',
      'GET /clear-database',
      'POST /devices',
      'GET /devices',
      'POST /devices/delete',
      'POST /connections',
      'GET /connections',
      'GET /export/kubevirt',
      'GET /network-topology'
    ]
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('🚀 Infrastructure Designer Backend starting...');
  console.log(`📡 Server running on http://localhost:${PORT}`);
  console.log('💾 Using in-memory storage (no Neo4j required)');
  console.log('🔍 Test the server: curl http://localhost:4000/health');
  console.log('📊 Available endpoints:');
  console.log('   GET  /               - API information');
  console.log('   GET  /health         - Health check');
  console.log('   GET  /export/kubevirt - Export infrastructure');
  console.log('   POST /devices        - Create device');
  console.log('   POST /connections    - Create connection');
});