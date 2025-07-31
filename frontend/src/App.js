import React, { useState, useEffect } from 'react';
import axios from 'axios';
import VM from './components/VM';
import Router from './components/Router';
import './App.css';

// Configure axios defaults
const API_BASE_URL = 'http://localhost:4000';
axios.defaults.baseURL = API_BASE_URL;
axios.defaults.timeout = 10000; // 10 second timeout

const App = () => {
  const [droppedDevices, setDroppedDevices] = useState([]);
  const [deviceCounters, setDeviceCounters] = useState({ vm: 0, router: 0 });
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [connections, setConnections] = useState([]);
  const [exportStatus, setExportStatus] = useState('');

  useEffect(() => {
    const initializeData = async () => {
      try {
        console.log('🧹 Clearing database...');
        await axios.get('/clear-database');
        console.log('✅ Database cleared');
        
        console.log('📋 Loading connections...');
        const response = await axios.get('/connections');
        setConnections(response.data || []);
        console.log('✅ Connections loaded:', response.data?.length || 0);
      } catch (error) {
        console.error('❌ Error initializing data:', error);
      }
    };

    initializeData();
  }, []);

  const createDevice = async (device) => {
    try {
      console.log('📝 Creating device:', device);
      const response = await axios.post('/devices', device);
      console.log('✅ Device created:', response.data);
    } catch (error) {
      console.error('❌ Error creating device:', error);
      if (error.response?.data?.error) {
        alert(`Error: ${error.response.data.error}`);
      }
    }
  };

  // Enhanced function to handle router interface IP assignment
  const assignRouterInterfaceIP = async (routerId, targetDeviceId, targetDeviceType) => {
    const router = droppedDevices.find(d => d.id === routerId);
    if (!router || router.type !== 'router') return null;

    // Get existing connections for this router to determine interface number
    const routerConnections = connections.filter(
      conn => conn.from === routerId || conn.to === routerId
    );
    const interfaceNumber = routerConnections.length + 1;

    const prompt_text = `Router ${routerId} Interface ${interfaceNumber} IP Configuration

This router is connecting to ${targetDeviceId} (${targetDeviceType}).
Each router interface needs its own IP address in a different subnet.

Examples:
- Interface 1: 192.168.1.1/24 (for first connection)
- Interface 2: 192.168.2.1/24 (for second connection)  
- Interface 3: 10.0.1.1/24 (for third connection)

Enter IP address for this interface (or leave empty for auto-assignment):`;

    const routerIP = prompt(prompt_text, '');
    
    if (routerIP && routerIP.trim()) {
      // Validate IP format
      const ipPattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
      if (!ipPattern.test(routerIP.trim())) {
        alert('❌ Invalid IP format. Use format like: 192.168.1.1');
        return null;
      }
    }

    return routerIP ? routerIP.trim() : null;
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const deviceType = e.dataTransfer.getData('device-type');
    const deviceId = e.dataTransfer.getData('device-id');
    const boundingBox = e.currentTarget.getBoundingClientRect();
    const newPosition = {
      x: e.clientX - boundingBox.left,
      y: e.clientY - boundingBox.top,
    };

    const inventory = document.getElementById('inventory');
    const bin = document.getElementById('bin');

    if (inventory && inventory.contains(e.target)) return;
    if (bin && bin.contains(e.target)) {
      setDroppedDevices((prevDevices) => prevDevices.filter((device) => device.id !== deviceId));
      setConnections((prevConnections) =>
        prevConnections.filter((connection) => connection.from !== deviceId && connection.to !== deviceId)
      );
      axios.post('/devices/delete', { deviceId }).catch((error) => {
        console.error('❌ Error deleting device:', error);
      });
      return;
    }

    if (deviceId) {
      setDroppedDevices((prevDevices) =>
        prevDevices.map((device) => (device.id === deviceId ? { ...device, position: newPosition } : device))
      );
    } else {
      const newId = `${deviceType.charAt(0).toUpperCase()}${deviceCounters[deviceType] + 1}`;
      let newDevice = { id: newId, type: deviceType, position: newPosition };

      if (deviceType === 'vm') {
        const cpu = prompt('Enter CPU for this VM:', '1 vCPU');
        const memory = prompt('Enter Memory for this VM (e.g., 2GB):', '2GB');
        const storage = prompt('Enter Storage for this VM (e.g., 10GB):', '10GB');
        const ip = prompt('Enter IP address for this VM (optional, e.g., 192.168.1.50):\nLeave empty for auto-assignment:', '');
        newDevice = { ...newDevice, cpu, memory, storage, ip };
      } else if (deviceType === 'router') {
        alert('🌐 Router created!\n\nNote: Router IP addresses will be configured per interface when you create connections.');
        newDevice = { ...newDevice, interfaceIPs: {} }; // Store multiple IPs per interface
      }

      createDevice(newDevice);
      setDroppedDevices((prevDevices) => [...prevDevices, newDevice]);
      setDeviceCounters((prevCounters) => ({
        ...prevCounters,
        [deviceType]: prevCounters[deviceType] + 1,
      }));
    }
  };

  const handleDragStart = (e, deviceType, deviceId) => {
    e.dataTransfer.setData('device-type', deviceType);
    e.dataTransfer.setData('device-id', deviceId || '');
  };

  const handleSingleClick = async (deviceId) => {
    if (selectedDevice && selectedDevice !== deviceId) {
      const fromDevice = droppedDevices.find((device) => device.id === selectedDevice);
      const toDevice = droppedDevices.find((device) => device.id === deviceId);

      if (!fromDevice || !toDevice) {
        return;
      }

      if (fromDevice.type === 'vm' && toDevice.type === 'vm') {
        alert('❌ Connecting VM with VM is prohibited.');
        return;
      }

      let routerInterfaceData = {};
      
      if (fromDevice.type === 'router') {
        const routerIP = await assignRouterInterfaceIP(fromDevice.id, toDevice.id, toDevice.type);
        if (routerIP) {
          routerInterfaceData.fromRouterIP = routerIP;
        }
      }
      
      if (toDevice.type === 'router') {
        const routerIP = await assignRouterInterfaceIP(toDevice.id, fromDevice.id, fromDevice.type);
        if (routerIP) {
          routerInterfaceData.toRouterIP = routerIP;
        }
      }

      const newConnection = { 
        from: selectedDevice, 
        to: deviceId, 
        ...routerInterfaceData
      };

      setConnections((prevConnections) => [...prevConnections, newConnection]);
      
      try {
        const response = await axios.post('/connections', newConnection);
        
        if (routerInterfaceData.fromRouterIP || routerInterfaceData.toRouterIP) {
          setDroppedDevices(prevDevices => 
            prevDevices.map(device => {
              if (device.id === fromDevice.id && routerInterfaceData.fromRouterIP) {
                const updatedDevice = { ...device };
                if (!updatedDevice.interfaceIPs) updatedDevice.interfaceIPs = {};
                updatedDevice.interfaceIPs[`to_${toDevice.id}`] = routerInterfaceData.fromRouterIP;
                return updatedDevice;
              }
              if (device.id === toDevice.id && routerInterfaceData.toRouterIP) {
                const updatedDevice = { ...device };
                if (!updatedDevice.interfaceIPs) updatedDevice.interfaceIPs = {};
                updatedDevice.interfaceIPs[`to_${fromDevice.id}`] = routerInterfaceData.toRouterIP;
                return updatedDevice;
              }
              return device;
            })
          );
        }
      } catch (error) {
        if (error.response?.data?.error) {
          alert(`Error: ${error.response.data.error}`);
          setConnections(prevConnections => 
            prevConnections.filter(conn => 
              !(conn.from === selectedDevice && conn.to === deviceId)
            )
          );
        }
      }

      setSelectedDevice(null);
    } else {
      setSelectedDevice(deviceId);
    }
  };

  // Enhanced export function with multi-step process
  const exportToKubeVirt = async () => {
    if (droppedDevices.length === 0) {
      alert('❌ No devices to export. Please add some devices first.');
      return;
    }

    try {
      setExportStatus('⏳ Generating KubeVirt configuration...');
      console.log('📦 Exporting to KubeVirt...');
      
      const response = await axios.get('/export/kubevirt', {
        responseType: 'blob'
      });
      
      // Create blob link to download the YAML file
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'kubevirt-infrastructure.yaml');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setExportStatus('✅ KubeVirt configuration exported successfully!');
      console.log('✅ Export successful');
      setTimeout(() => setExportStatus(''), 3000);
    } catch (error) {
      console.error('❌ Error exporting to KubeVirt:', error);
      setExportStatus('❌ Error exporting configuration. Please try again.');
      setTimeout(() => setExportStatus(''), 5000);
    }
  };

  // Export PVCs only (step 1)
  const exportPVCs = async () => {
    if (droppedDevices.length === 0) {
      alert('❌ No devices to export. Please add some devices first.');
      return;
    }

    try {
      setExportStatus('⏳ Generating PVCs configuration...');
      
      const response = await axios.get('/export/kubevirt-pvcs', {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'kubevirt-infrastructure-pvcs.yaml');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setExportStatus('✅ PVCs exported! Apply this first, then wait for CDI import to complete.');
      setTimeout(() => setExportStatus(''), 5000);
    } catch (error) {
      console.error('❌ Error exporting PVCs:', error);
      setExportStatus('❌ Error exporting PVCs. Please try again.');
      setTimeout(() => setExportStatus(''), 5000);
    }
  };

  // Export VMs only (step 2)
  const exportVMs = async () => {
    if (droppedDevices.length === 0) {
      alert('❌ No devices to export. Please add some devices first.');
      return;
    }

    try {
      setExportStatus('⏳ Generating VMs configuration...');
      
      const response = await axios.get('/export/kubevirt-vms', {
        responseType: 'blob'
      });
      
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'kubevirt-infrastructure-vms.yaml');
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      
      setExportStatus('✅ VMs exported! Apply this after PVCs are ready.');
      setTimeout(() => setExportStatus(''), 5000);
    } catch (error) {
      console.error('❌ Error exporting VMs:', error);
      setExportStatus('❌ Error exporting VMs. Please try again.');
      setTimeout(() => setExportStatus(''), 5000);
    }
  };

  const clearInfrastructure = async () => {
    if (window.confirm('🗑️ Are you sure you want to clear all devices and connections?')) {
      try {
        console.log('🧹 Clearing infrastructure...');
        await axios.get('/clear-database');
        setDroppedDevices([]);
        setConnections([]);
        setDeviceCounters({ vm: 0, router: 0 });
        setSelectedDevice(null);
        console.log('✅ Infrastructure cleared');
      } catch (error) {
        console.error('❌ Error clearing infrastructure:', error);
      }
    }
  };

  return (
    <div className="app">
      <h1>Design your infra here:</h1>
      
      <div className="controls">
        <div className="export-controls">
          <button 
            className="export-button" 
            onClick={exportToKubeVirt}
            disabled={droppedDevices.length === 0}
            title="Export complete infrastructure as single YAML"
          >
            📦 Export Complete
          </button>
          <button 
            className="export-button" 
            onClick={exportPVCs}
            disabled={droppedDevices.length === 0}
            title="Export PVCs only (step 1)"
          >
            💾 Export PVCs
          </button>
          <button 
            className="export-button" 
            onClick={exportVMs}
            disabled={droppedDevices.length === 0}
            title="Export VMs only (step 2)"
          >
            🖥️ Export VMs
          </button>
          <button 
            className="clear-button" 
            onClick={clearInfrastructure}
            title="Clear all devices and connections"
          >
            🗑️ Clear All
          </button>
          {exportStatus && (
            <div className={`export-status ${exportStatus.includes('❌') ? 'error' : 'success'}`}>
              {exportStatus}
            </div>
          )}
        </div>
      </div>

      <div className="container">
        <div id="inventory" className="inventory">
          <h2>Inventory</h2>
          <div className="device-container">
            <VM onDragStart={(e) => handleDragStart(e, 'vm')} isInInventory={true} />
            <span className="device-label">Virtual Machine</span>
          </div>
          <div className="device-container">
            <Router onDragStart={(e) => handleDragStart(e, 'router')} isInInventory={true} />
            <span className="device-label">Network Router</span>
          </div>
          
          <div className="inventory-info">
            <h3>Statistics</h3>
            <p>VMs: {droppedDevices.filter(d => d.type === 'vm').length}</p>
            <p>Routers: {droppedDevices.filter(d => d.type === 'router').length}</p>
            <p>Connections: {connections.length}</p>
          </div>
        </div>
        
        <div className="bigger-box" onDrop={handleDrop} onDragOver={(e) => e.preventDefault()}>
          <svg className="connections">
            {connections.map((connection, index) => {
              const fromDevice = droppedDevices.find((device) => device.id === connection.from);
              const toDevice = droppedDevices.find((device) => device.id === connection.to);
              return (
                fromDevice &&
                toDevice && (
                  <line
                    key={index}
                    x1={fromDevice.position.x + 40}
                    y1={fromDevice.position.y + 40}
                    x2={toDevice.position.x + 40}
                    y2={toDevice.position.y + 40}
                    stroke="#ffffff"
                    strokeWidth={1}
                  />
                )
              );
            })}
          </svg>
          
          {droppedDevices.map((device) => (
            <div
              key={device.id}
              style={{
                position: 'absolute',
                left: device.position.x,
                top: device.position.y,
                cursor: 'pointer',
                border: selectedDevice === device.id ? '2px solid #00d8ff' : '2px solid transparent',
                borderRadius: '50%',
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, device.type, device.id)}
              onClick={() => handleSingleClick(device.id)}
            >
              {device.type === 'vm' && (
                <VM 
                  id={device.id} 
                  isInInventory={false} 
                  cpu={device.cpu} 
                  memory={device.memory} 
                  storage={device.storage}
                  ip={device.ip}
                />
              )}
              {device.type === 'router' && (
                <Router 
                  id={device.id} 
                  isInInventory={false}
                  interfaceIPs={device.interfaceIPs}
                />
              )}
            </div>
          ))}
          
          <div id="bin" className="bin">
            🗑️
          </div>
          
          {droppedDevices.length === 0 && (
            <div className="empty-canvas">
              <h2>🚀 Start Building Your Infrastructure</h2>
              <p>Drag devices from the inventory to get started</p>
              <ul>
                <li>🖱️ Drag & drop devices from the left panel</li>
                <li>🔗 Click devices to create connections</li>
                <li>🌐 Configure custom IP addresses</li>
                <li>🌐 Routers get per-interface IP configuration</li>
                <li>📦 Export to KubeVirt when ready</li>
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;