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
// Enhanced KubeVirt Export with CDI monitoring instructions
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

// Export PVCs only (first step)
app.get('/export/kubevirt-pvcs', (req, res) => {
  console.log('📦 Exporting KubeVirt PVCs...');
  console.log(`📊 Current state: ${devices.length} devices, ${connections.length} connections`);
  
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

// Export VMs only (second step)
app.get('/export/kubevirt-vms', (req, res) => {
  console.log('📦 Exporting KubeVirt VMs...');
  console.log(`📊 Current state: ${devices.length} devices, ${connections.length} connections`);
  
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

// Export deployment script
app.get('/export/deploy-script', (req, res) => {
  console.log('📝 Generating deployment script...');
  
  try {
    if (devices.length === 0) {
      return res.status(400).json({ error: 'No devices to export. Please add some devices first.' });
    }
    
    const deployScript = generateDeploymentScript(devices);
    
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="deploy.sh"');
    
    console.log('✅ Deployment script generated successfully');
    res.send(deployScript);
  } catch (error) {
    console.error('❌ Error generating deployment script:', error);
    res.status(500).json({ error: `Failed to generate deployment script: ${error.message}` });
  }
});

// Export monitoring commands
app.get('/export/monitoring-commands', (req, res) => {
  try {
    const vms = devices.filter(d => ['vm', 'router', 'switch'].includes(d.type));
    
    const commands = {
      checkAllPVCs: 'kubectl get pvc',
      checkImportStatus: vms.map(device => ({
        vm: device.id,
        command: `kubectl get pvc ${device.id.toLowerCase()}-pvc -o jsonpath='{.metadata.annotations.cdi\\.kubevirt\\.io/storage\\.pod\\.phase}'`
      })),
      checkImportLogs: vms.map(device => ({
        vm: device.id,
        command: `kubectl logs -l cdi.kubevirt.io/storage.import.importPvcName=${device.id.toLowerCase()}-pvc -n cdi`
      })),
      accessConsole: vms.map(device => ({
        vm: device.id,
        command: `virtctl console ${device.id.toLowerCase()}`
      })),
      monitoringScript: generateMonitoringScript(vms)
    };
    
    res.json(commands);
  } catch (error) {
    console.error('❌ Error generating monitoring commands:', error);
    res.status(500).json({ error: error.message });
  }
});

// Generate a bash monitoring script
function generateMonitoringScript(vms) {
  return `#!/bin/bash
# KubeVirt Infrastructure Monitoring Script
# Generated: ${new Date().toISOString()}

echo "🔍 Monitoring KubeVirt Infrastructure Import Status"
echo "=================================================="

# Check if kubectl is available
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl first."
    exit 1
fi

# Check if virtctl is available
if ! command -v virtctl &> /dev/null; then
    echo "⚠️  virtctl not found. Console access will not be available."
fi

echo ""
echo "📋 Checking PVC Status:"
kubectl get pvc

echo ""
echo "🔄 Checking CDI Import Status for each VM:"
${vms.map(vm => `
echo "  VM: ${vm.id}"
STATUS=$(kubectl get pvc ${vm.id.toLowerCase()}-pvc -o jsonpath='{.metadata.annotations.cdi\\.kubevirt\\.io/storage\\.pod\\.phase}' 2>/dev/null)
if [ "$STATUS" = "Succeeded" ]; then
    echo "    ✅ Import Status: $STATUS"
else
    echo "    ⏳ Import Status: $STATUS (waiting for Succeeded)"
fi`).join('')}

echo ""
echo "🚀 Checking VM Status:"
${vms.map(vm => `
echo "  VM: ${vm.id}"
kubectl get vm ${vm.id.toLowerCase()} 2>/dev/null || echo "    ❌ VM not found"
kubectl get vmi ${vm.id.toLowerCase()} 2>/dev/null || echo "    ⏳ VMI not ready yet"`).join('')}

echo ""
echo "📝 Ready VMs for console access:"
${vms.map(vm => `
STATUS=$(kubectl get pvc ${vm.id.toLowerCase()}-pvc -o jsonpath='{.metadata.annotations.cdi\\.kubevirt\\.io/storage\\.pod\\.phase}' 2>/dev/null)
VMI_STATUS=$(kubectl get vmi ${vm.id.toLowerCase()} -o jsonpath='{.status.phase}' 2>/dev/null)
if [ "$STATUS" = "Succeeded" ] && [ "$VMI_STATUS" = "Running" ]; then
    echo "  ✅ ${vm.id}: virtctl console ${vm.id.toLowerCase()}"
else
    echo "  ⏳ ${vm.id}: Not ready yet (Import: $STATUS, VMI: $VMI_STATUS)"
fi`).join('')}

echo ""
echo "🔑 Login credentials for all VMs:"
echo "  - root:myrootpassword"
echo "  - debian:userpassword"
echo ""
echo "💡 Run this script periodically to monitor import progress:"
echo "   watch -n 30 $0"
`;
}

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

// Updated KubeVirt YAML Generation with separated PVCs and VMs
function generateKubeVirtInfrastructure(devices, connections) {
  const components = [];
  
  // Add header comment with deployment strategy
  components.push(`# KubeVirt Infrastructure Configuration
# Generated from Infrastructure Designer
# Date: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
#
# DEPLOYMENT STRATEGY:
# ===================
# 1. First apply PVCs (this file ends with -pvcs.yaml)
# 2. Monitor CDI import progress until all show "Succeeded"
# 3. Then apply VMs (separate file ends with -vms.yaml)
#
# Split deployment commands:
# kubectl apply -f kubevirt-infrastructure-pvcs.yaml
# # Wait for imports to complete, then:
# kubectl apply -f kubevirt-infrastructure-vms.yaml
#`);
  
  // Generate network attachments first
  components.push(generateNetworkAttachments());
  
  // Separate devices by type
  const routers = devices.filter(d => d.type === 'router');
  const switches = devices.filter(d => d.type === 'switch');
  const vms = devices.filter(d => d.type === 'vm');
  
  console.log(`📊 Generating: ${routers.length} routers, ${switches.length} switches, ${vms.length} VMs`);
  
  // Generate PVCs for all VM-like devices first
  components.push('# ========================================');
  components.push('# PVCs - Apply these first and wait for CDI import completion');
  components.push('# ========================================');
  
  vms.forEach(vm => {
    components.push(generateVMPVC(vm));
  });
  
  routers.forEach(router => {
    components.push(generateRouterPVC(router));
  });
  
  switches.forEach(switch_ => {
    components.push(generateSwitchPVC(switch_));
  });
  
  // Add monitoring section
  components.push(generateMonitoringInstructions(devices));
  
  return components.join('\n---\n');
}

// Generate separate VMs file
function generateVMsOnly(devices, connections) {
  const components = [];
  
  components.push(`# KubeVirt Virtual Machines Configuration
# Generated from Infrastructure Designer
# Date: ${new Date().toISOString()}
#
# IMPORTANT: Only apply this after all PVCs show "Succeeded" status
# Check with: kubectl get pvc
#`);
  
  const routers = devices.filter(d => d.type === 'router');
  const switches = devices.filter(d => d.type === 'switch');
  const vms = devices.filter(d => d.type === 'vm');
  
  // Generate VMs only (no PVCs)
  vms.forEach(vm => {
    components.push(generateVMOnly(vm));
  });
  
  routers.forEach(router => {
    components.push(generateRouterVMOnly(router));
  });
  
  switches.forEach(switch_ => {
    components.push(generateSwitchVMOnly(switch_));
  });
  
  return components.join('\n---\n');
}

// Generate separate PVCs file
function generatePVCsOnly(devices, connections) {
  const components = [];
  
  // Add header comment
  components.push(`# KubeVirt Infrastructure - PVCs Only
# Generated from Infrastructure Designer
# Date: ${new Date().toISOString()}
# Devices: ${devices.length} | Connections: ${connections.length}
#
# This file contains only PVCs with CDI import configurations
# Apply this first and wait for CDI import to complete before applying VMs
#`);
  
  // Generate network attachments first
  components.push(generateNetworkAttachments());
  
  // Generate only PVCs for each device type
  const routers = devices.filter(d => d.type === 'router');
  const switches = devices.filter(d => d.type === 'switch');
  const vms = devices.filter(d => d.type === 'vm');
  
  console.log(`📊 Generating PVCs for: ${routers.length} routers, ${switches.length} switches, ${vms.length} VMs`);
  
  // Generate PVCs only
  vms.forEach(vm => {
    components.push(generateVMPVC(vm));
  });
  
  routers.forEach(router => {
    components.push(generateRouterPVC(router));
  });
  
  switches.forEach(switch_ => {
    components.push(generateSwitchPVC(switch_));
  });
  
  return components.join('\n---\n');
}

// Generate deployment script
function generateDeploymentScript(devices) {
  const vms = devices.filter(d => ['vm', 'router', 'switch'].includes(d.type));
  
  return `#!/bin/bash
# KubeVirt Infrastructure Deployment Script
# Generated: ${new Date().toISOString()}

set -e

echo "🚀 Deploying KubeVirt Infrastructure"
echo "====================================="

# Check prerequisites
if ! command -v kubectl &> /dev/null; then
    echo "❌ kubectl not found. Please install kubectl first."
    exit 1
fi

if ! command -v virtctl &> /dev/null; then
    echo "⚠️  virtctl not found. Console access will not be available."
fi

# Step 1: Apply PVCs
echo ""
echo "📦 Step 1: Creating PVCs and starting CDI import..."
kubectl apply -f kubevirt-infrastructure-pvcs.yaml

# Step 2: Monitor import progress
echo ""
echo "⏳ Step 2: Monitoring CDI import progress..."
echo "This may take several minutes depending on network speed and image size."

READY=false
TIMEOUT=1800  # 30 minutes timeout
ELAPSED=0

while [ "$READY" = false ] && [ $ELAPSED -lt $TIMEOUT ]; do
    echo ""
    echo "🔍 Checking PVC import status... ($ELAPSED/$TIMEOUT seconds)"
    
    ALL_SUCCEEDED=true
    ${vms.map(device => {
      const name = device.id.toLowerCase();
      return `    
    STATUS_${device.id.toUpperCase()}=$(kubectl get pvc ${name}-pvc -o jsonpath='{.metadata.annotations.cdi\\.kubevirt\\.io/storage\\.pod\\.phase}' 2>/dev/null || echo "NotFound")
    echo "  ${device.id}: $STATUS_${device.id.toUpperCase()}"
    if [ "$STATUS_${device.id.toUpperCase()}" != "Succeeded" ]; then
        ALL_SUCCEEDED=false
    fi`;
    }).join('')}
    
    if [ "$ALL_SUCCEEDED" = true ]; then
        READY=true
        echo ""
        echo "✅ All PVCs imported successfully!"
    else
        echo "⏳ Waiting for imports to complete..."
        sleep 30
        ELAPSED=$((ELAPSED + 30))
    fi
done

if [ "$READY" = false ]; then
    echo ""
    echo "❌ Timeout waiting for PVC imports to complete."
    echo "Check the import status manually and run VMs deployment when ready:"
    echo "kubectl apply -f kubevirt-infrastructure-vms.yaml"
    exit 1
fi

# Step 3: Deploy VMs
echo ""
echo "🚀 Step 3: Deploying Virtual Machines..."
kubectl apply -f kubevirt-infrastructure-vms.yaml

echo ""
echo "⏳ Waiting for VMs to start..."
sleep 10

# Step 4: Show status
echo ""
echo "📊 Final Status:"
kubectl get vm
echo ""
kubectl get vmi

echo ""
echo "✅ Deployment completed!"
echo ""
echo "🖥️  Access VM consoles when ready:"
${vms.map(device => `echo "  virtctl console ${device.id.toLowerCase()}"`).join('\n')}
echo ""
echo "🔑 Login credentials:"
echo "  - root:myrootpassword"
echo "  - debian:userpassword"
echo ""
echo "📋 Monitor ongoing status:"
echo "  kubectl get vm"
echo "  kubectl get vmi"
echo "  kubectl get pvc"
`;
}

// PVC generation functions
function generateVMPVC(vm) {
  const vmName = vm.id.toLowerCase();
  const storage = normalizeStorageQuantity(vm.storage);
  
  return `# PVC for VM: ${vm.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${vmName}-pvc"
  labels:
    app: containerized-data-importer
    device-type: vm
    device-id: ${vm.id}
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

function generateRouterPVC(router) {
  const routerName = router.id.toLowerCase();
  
  return `# PVC for Router: ${router.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${routerName}-pvc"
  labels:
    app: containerized-data-importer
    device-type: router
    device-id: ${router.id}
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
  storageClassName: nfs-client`;
}

function generateSwitchPVC(switch_) {
  const switchName = switch_.id.toLowerCase();
  
  return `# PVC for Switch: ${switch_.id}
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: "${switchName}-pvc"
  labels:
    app: containerized-data-importer
    device-type: switch
    device-id: ${switch_.id}
  annotations:
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 8Gi
  storageClassName: nfs-client`;
}

// VM-only generation functions (no PVCs)
function generateVMOnly(vm) {
  const vmName = vm.id.toLowerCase();
  const memory = vm.memory ? vm.memory.replace(/Gi|GB/i, 'G') : '2G';
  const cpu = vm.cpu ? parseInt(vm.cpu.match(/\d+/)[0]) || 1 : 1;
  
  return `# VM: ${vm.id}
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${vmName}
  labels:
    kubevirt.io/os: linux
    device-type: vm
    device-id: ${vm.id}
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

function generateRouterVMOnly(router) {
  const routerName = router.id.toLowerCase();
  
  return `# Router VM: ${router.id}
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${routerName}
  labels:
    kubevirt.io/os: linux
    device-type: router
    device-id: ${router.id}
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 1
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
            memory: 1Gi
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
                root:myrootpassword
                debian:userpassword
              expire: False
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

function generateSwitchVMOnly(switch_) {
  const switchName = switch_.id.toLowerCase();
  
  return `# Switch VM: ${switch_.id}
apiVersion: kubevirt.io/v1
kind: VirtualMachine
metadata:
  name: ${switchName}
  labels:
    kubevirt.io/os: linux
    device-type: switch
    device-id: ${switch_.id}
spec:
  running: true
  template:
    spec:
      domain:
        cpu:
          cores: 1
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
            memory: 1Gi
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
                root:myrootpassword
                debian:userpassword
              expire: False
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

function generateMonitoringInstructions(devices) {
  const vms = devices.filter(d => ['vm', 'router', 'switch'].includes(d.type));
  
  return `
# ========================================
# MONITORING INSTRUCTIONS
# ========================================
#
# 1. Apply PVCs first:
#    kubectl apply -f kubevirt-infrastructure-pvcs.yaml
#
# 2. Monitor CDI import progress:
#    kubectl get pvc
#
# 3. Check individual PVC status:
${vms.map(device => 
`#    kubectl get pvc ${device.id.toLowerCase()}-pvc -o jsonpath='{.metadata.annotations.cdi\\.kubevirt\\.io/storage\\.pod\\.phase}'`
).join('\n')}
#
# 4. Wait for ALL PVCs to show "Succeeded" status
#
# 5. Apply VMs:
#    kubectl apply -f kubevirt-infrastructure-vms.yaml
#
# 6. Access consoles when VMs are running:
${vms.map(device => 
`#    virtctl console ${device.id.toLowerCase()}`
).join('\n')}
#
# Login credentials: root:myrootpassword or debian:userpassword`;
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

// Replace the generateVMInfrastructure function in your server.js with this:

function generateVMInfrastructure(vm) {
  const vmName = vm.id.toLowerCase();
  const memory = vm.memory ? vm.memory.replace(/Gi|GB/i, 'G') : '2G';
  const cpu = vm.cpu ? parseInt(vm.cpu.match(/\d+/)[0]) || 1 : 1;
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

// Also update the normalizeStorageQuantity function to ensure proper defaults:
function normalizeStorageQuantity(storage) {
  if (!storage) return '10Gi'; // Changed from 20Gi to 10Gi
  const cleaned = storage.toString().trim().replace(/\s+/g, '');
  
  // Convert common formats to Kubernetes format
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
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 10Gi
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
          cores: 1
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
            memory: 1Gi
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
                root:myrootpassword
                debian:userpassword
              expire: False
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
    cdi.kubevirt.io/storage.import.endpoint: "https://cdimage.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.raw"
spec:
  accessModes:
  - ReadWriteOnce
  resources:
    requests:
      storage: 8Gi
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
          cores: 1
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
            memory: 1Gi
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
                root:myrootpassword
                debian:userpassword
              expire: False
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
  if (!storage) return '10Gi';
  const cleaned = storage.toString().trim().replace(/\s+/g, '');
  
  // Convert common formats to Kubernetes format
  return cleaned
    .replace(/(\d+)GB?$/i, '$1Gi')
    .replace(/(\d+)MB?$/i, '$1Mi')
    .replace(/(\d+)TB?$/i, '$1Ti')
    .replace(/(\d+)G$/i, '$1Gi')
    .replace(/(\d+)M$/i, '$1Mi')
    .replace(/(\d+)T$/i, '$1Ti') || '10Gi';
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