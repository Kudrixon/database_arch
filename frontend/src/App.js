import React, { useState, useEffect } from 'react';
import axios from 'axios';
import VM from './components/VM';
import Switch from './components/Switch';
import Router from './components/Router';
import './App.css';

const App = () => {
  const [droppedDevices, setDroppedDevices] = useState([]);
  const [deviceCounters, setDeviceCounters] = useState({ vm: 0, switch: 0, router: 0 });
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [connections, setConnections] = useState([]);

  useEffect(() => {
    const initializeData = async () => {
      try {
        await axios.get('http://localhost:4000/clear-database');
        console.log('Database cleared on app refresh');
        const response = await axios.get('http://localhost:4000/connections');
        setConnections(response.data);
      } catch (error) {
        console.error('Error initializing data', error);
      }
    };

    initializeData();
  }, []);

  const createDevice = async (device) => {
    try {
      const response = await axios.post('http://localhost:4000/devices', device);
      console.log('Device created:', response.data);
    } catch (error) {
      console.error('Error creating device:', error);
    }
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
      axios.post('http://localhost:4000/devices/delete', { deviceId }).catch((error) => {
        console.error('Error deleting device', error);
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
        const cpu = prompt('Enter CPU for this VM:', '4 vCPUs');
        const memory = prompt('Enter Memory for this VM (e.g., 16GB):', '16GB');
        const storage = prompt('Enter Storage for this VM (e.g., 256GB):', '256GB');
        newDevice = { ...newDevice, cpu, memory, storage };
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

  const handleSingleClick = (deviceId) => {
    if (selectedDevice && selectedDevice !== deviceId) {
      const fromDevice = droppedDevices.find((device) => device.id === selectedDevice);
      const toDevice = droppedDevices.find((device) => device.id === deviceId);

      if (!fromDevice || !toDevice) {
        console.error('Device not found.');
        return;
      }

      if (fromDevice.type === 'vm' && toDevice.type === 'vm') {
        console.log('Connecting VM with VM is prohibited.');
        return;
      }

      const speed = prompt("Enter network speed for this connection (e.g., '1 Gbps'):", '1 Gbps');
      if (!speed) {
        console.log('Connection speed is required. Connection not created.');
        return;
      }

      const speedPattern = /^[0-9]+(\.[0-9]+)?\s*(Gbps|Mbps)$/;
      if (!speedPattern.test(speed)) {
        console.log('Invalid speed format. Connection not created.');
        return;
      }

      const newConnection = { from: selectedDevice, to: deviceId, speed };
      console.log('Creating connection:', newConnection);

      setConnections((prevConnections) => [...prevConnections, newConnection]);
      axios.post('http://localhost:4000/connections', newConnection)
        .then((response) => {
          console.log('Connection saved:', response.data);
        })
        .catch((error) => {
          console.error('Error saving connection:', error);
        });

      setSelectedDevice(null);
    } else {
      setSelectedDevice(deviceId);
    }
  };


  const downloadYaml = async () => {
    try {
      const response = await axios.get('http://localhost:4000/export/kubevirt', { responseType: 'blob' });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'kubevirt-blueprint.yaml');
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error('Error downloading YAML', error);
    }
  };

  return (
    <div className="app">
      <h1>Design your infra here:</h1>
      <div className="path-selection">
        <button onClick={downloadYaml}>Download YAML</button>
      </div>
      <div className="container">
        <div id="inventory" className="inventory">
          <h2>Inventory</h2>
          <div className="device-container">
            <VM onDragStart={(e) => handleDragStart(e, 'vm')} isInInventory={true} />
          </div>
          <div className="device-container">
            <Switch onDragStart={(e) => handleDragStart(e, 'switch')} isInInventory={true} />
          </div>
          <div className="device-container">
            <Router onDragStart={(e) => handleDragStart(e, 'router')} isInInventory={true} />
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
                  <g key={index}>
                    <line
                      x1={fromDevice.position.x + 40}
                      y1={fromDevice.position.y + 40}
                      x2={toDevice.position.x + 40}
                      y2={toDevice.position.y + 40}
                      stroke="white"
                      strokeWidth={1}
                    />
                    <text
                      x={(fromDevice.position.x + toDevice.position.x) / 2}
                      y={(fromDevice.position.y + toDevice.position.y) / 2}
                      fill="red"
                    >
                      {connection.speed}
                    </text>
                  </g>
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
              }}
              draggable
              onDragStart={(e) => handleDragStart(e, device.type, device.id)}
              onClick={() => handleSingleClick(device.id)}
            >
              {device.type === 'vm' && (
                <VM id={device.id} isInInventory={false} cpu={device.cpu} memory={device.memory} storage={device.storage} />
              )}
              {device.type === 'switch' && <Switch id={device.id} isInInventory={false} />}
              {device.type === 'router' && <Router id={device.id} isInInventory={false} />}
            </div>
          ))}
          <div id="bin" className="bin">
            🗑️ Bin
          </div>
        </div>
      </div>
    </div>
  );
};

export default App;
