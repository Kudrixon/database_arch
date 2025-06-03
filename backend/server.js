const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const cors = require('cors');
const bodyParser = require('body-parser');
const yaml = require('js-yaml');

const app = express();
app.use(cors());
app.use(bodyParser.json());

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

const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
  db.run('CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, type TEXT, cpu TEXT, memory TEXT, storage TEXT)');
  db.run('CREATE TABLE IF NOT EXISTS connections (id INTEGER PRIMARY KEY AUTOINCREMENT, from_device TEXT, to_device TEXT, speed REAL, unit TEXT)');
});

const clearDatabase = () => {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('DELETE FROM connections', (err) => {
        if (err) return reject(err);
        db.run('DELETE FROM devices', (err2) => {
          if (err2) return reject(err2);
          console.log('Database cleared');
          resolve();
        });
      });
    });
  });
};

clearDatabase(); // Clear database on server start

app.get('/clear-database', async (req, res) => {
  try {
    await clearDatabase();
    res.send({ message: 'Database cleared' });
  } catch (err) {
    res.status(500).send(err);
  }
});

app.post('/devices', (req, res) => {
  const { id, type, cpu, memory, storage } = req.body;
  db.run(
    'INSERT INTO devices (id, type, cpu, memory, storage) VALUES (?, ?, ?, ?, ?)',
    [id, type, cpu, memory, storage],
    (err) => {
      if (err) {
        console.error('Error creating device:', err);
        return res.status(500).send(err);
      }
      res.send({ id, type, cpu, memory, storage });
    }
  );
});

app.post('/connections', (req, res) => {
  const { from, to, speed } = req.body;
  console.log('Creating connection:', { from, to, speed });
  const { value: speedMbps, unit } = convertSpeedToMbps(speed);

  db.all('SELECT id, type FROM devices WHERE id IN (?, ?)', [from, to], (err, rows) => {
    if (err) {
      console.error('Error fetching devices:', err);
      return res.status(500).send(err);
    }

    if (rows.length < 2) {
      return res.status(404).send({ error: 'One or both devices not found.' });
    }

    const fromType = rows.find(r => r.id === from).type;
    const toType = rows.find(r => r.id === to).type;

    if (fromType === 'vm' && toType === 'vm') {
      return res.status(400).send({ error: 'Connecting VM with VM is prohibited.' });
    }

    db.run(
      'INSERT INTO connections (from_device, to_device, speed, unit) VALUES (?, ?, ?, ?)',
      [from, to, speedMbps, unit],
      function (err2) {
        if (err2) {
          console.error('Error creating connection:', err2);
          return res.status(500).send(err2);
        }
        res.send({ id: this.lastID });
      }
    );
  });
});

app.get('/connections', (req, res) => {
  db.all('SELECT from_device AS "from", to_device AS "to", speed, unit FROM connections', [], (err, rows) => {
    if (err) {
      console.error('Error fetching connections:', err);
      return res.status(500).send(err);
    }

    const connections = rows.map(row => ({
      from: row.from,
      to: row.to,
      speed: `${convertSpeedFromMbps(row.speed, row.unit)}${row.unit}`
    }));
    res.send(connections);
  });
});

app.post('/devices/delete', (req, res) => {
  const { deviceId } = req.body;
  db.run('DELETE FROM connections WHERE from_device = ? OR to_device = ?', [deviceId, deviceId], (err) => {
    if (err) {
      console.error('Error deleting connections:', err);
      return res.status(500).send(err);
    }
    db.run('DELETE FROM devices WHERE id = ?', [deviceId], (err2) => {
      if (err2) {
        console.error('Error deleting device:', err2);
        return res.status(500).send(err2);
      }
      res.send({ message: 'Device deleted' });
    });
  });
});


const generateKubeVirtBlueprint = (vms, connections) => {
  const docs = [];

  vms.forEach(vm => {
    const cpuCount = parseInt((vm.cpu || '').match(/\d+/)) || 1;
    const memory = vm.memory || '1Gi';

    docs.push({
      apiVersion: 'kubevirt.io/v1',
      kind: 'VirtualMachine',
      metadata: { name: vm.id.toLowerCase() },
      spec: {
        running: false,
        template: {
          metadata: { labels: { 'kubevirt.io/domain': vm.id.toLowerCase() } },
          spec: {
            domain: {
              cpu: { cores: cpuCount },
              resources: { requests: { memory } }
            }
          }
        }
      }
    });
  });

  docs.push({
    apiVersion: 'v1',
    kind: 'ConfigMap',
    metadata: { name: 'connections' },
    data: { connections: JSON.stringify(connections, null, 2) }
  });

  return docs.map(d => yaml.dump(d)).join('---\n');
};

app.get('/export/kubevirt', (req, res) => {
  db.all('SELECT * FROM devices WHERE type = ?', ['vm'], (err, vms) => {
    if (err) {
      console.error('Error fetching VMs:', err);
      return res.status(500).send(err);
    }

    db.all('SELECT from_device AS "from", to_device AS "to", speed, unit FROM connections', [], (err2, connRows) => {
      if (err2) {
        console.error('Error fetching connections:', err2);
        return res.status(500).send(err2);
      }

      const connections = connRows.map(r => ({
        from: r.from,
        to: r.to,
        speed: `${r.speed}${r.unit}`
      }));

      const yamlData = generateKubeVirtBlueprint(vms, connections);
      res.header('Content-Type', 'application/x-yaml');
      res.send(yamlData);
    });
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});