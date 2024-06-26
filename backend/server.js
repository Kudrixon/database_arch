const express = require('express');
const neo4j = require('neo4j-driver');
const cors = require('cors');
const bodyParser = require('body-parser');

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

const driver = neo4j.driver(
  process.env.NEO4J_URI || 'bolt://localhost:7687',
  neo4j.auth.basic(process.env.NEO4J_USER || 'neo4j', process.env.NEO4J_PASSWORD || 'Trudnehaslo_30')
);

const clearDatabase = async () => {
  const session = driver.session();
  try {
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('Database cleared');
  } catch (error) {
    console.error('Error clearing database:', error);
  } finally {
    await session.close();
  }
};

clearDatabase(); // Clear database on server start

app.get('/clear-database', async (req, res) => {
  await clearDatabase();
  res.send({ message: 'Database cleared' });
});

const buildDevicePropertiesQuery = (params) => {
  return Object.entries(params)
    .filter(([key, value]) => value !== undefined)
    .map(([key, value]) => `${key}: $${key}`)
    .join(', ');
};

app.post('/devices', async (req, res) => {
  const { id, type, cpu, memory, storage } = req.body;
  const session = driver.session();
  const deviceProperties = buildDevicePropertiesQuery({ id, type, cpu, memory, storage });

  try {
    const result = await session.run(
      `CREATE (a:Device {${deviceProperties}}) RETURN a`,
      { id, type, cpu, memory, storage }
    );
    res.send(result);
  } catch (error) {
    console.error('Error creating device:', error);
    res.status(500).send(error);
  } finally {
    await session.close();
  }
});

app.post('/connections', async (req, res) => {
  const { from, to, speed } = req.body;
  const session = driver.session();

  try {
    console.log('Creating connection:', { from, to, speed });
    const { value: speedMbps, unit } = convertSpeedToMbps(speed);

    const result = await session.run(
      'MATCH (a:Device {id: $fromId}), (b:Device {id: $toId}) RETURN a.type AS fromType, b.type AS toType',
      { fromId: from, toId: to }
    );

    if (result.records.length === 0) {
      console.error('Error: One or both devices not found.');
      return res.status(404).send({ error: 'One or both devices not found.' });
    }

    const fromType = result.records[0].get('fromType');
    const toType = result.records[0].get('toType');

    if (fromType === 'vm' && toType === 'vm') {
      return res.status(400).send({ error: 'Connecting VM with VM is prohibited.' });
    }

    const createResult = await session.run(
      'MATCH (a:Device {id: $fromId}), (b:Device {id: $toId}) ' +
      'MERGE (a)-[r:CONNECTED_TO {speed: $speed, unit: $unit}]->(b)',
      { fromId: from, toId: to, speed: speedMbps, unit: unit }
    );
    res.send(createResult);
  } catch (error) {
    console.error('Error creating connection:', error);
    res.status(500).send(error);
  } finally {
    await session.close();
  }
});

app.get('/connections', async (req, res) => {
  const session = driver.session();

  try {
    const result = await session.run(
      'MATCH (a:Device)-[r:CONNECTED_TO]->(b:Device) RETURN a.id AS from, b.id AS to, r.speed AS speed'
    );
    const connections = result.records.map(record => ({
      from: record.get('from'),
      to: record.get('to'),
      speed: `${convertSpeedFromMbps(record.get('from'), record.get('unit'))}${record.get('unit')}`,
    }));
    res.send(connections);
  } catch (error) {
    console.error('Error fetching connections:', error);
    res.status(500).send(error);
  } finally {
    await session.close();
  }
});

app.post('/devices/delete', async (req, res) => {
  const { deviceId } = req.body;
  const session = driver.session();

  try {
    const result = await session.run(
      'MATCH (a:Device {id: $deviceId}) DETACH DELETE a',
      { deviceId }
    );
    res.send(result);
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).send(error);
  } finally {
    await session.close();
  }
});

const parseSpeed = (speed) => {
  const [value, unit] = speed.split(' ');
  const numericValue = parseFloat(value);
  switch (unit.toLowerCase()) {
    case 'gbps':
      return numericValue * 1000;
    case 'mbps':
      return numericValue;
    default:
      return numericValue;
  }
};

app.get('/devices/fastest-path/:from/:to', async (req, res) => {
  const { from, to } = req.params;
  const session = driver.session();

  try {
    const result = await session.run(
      `MATCH (start:Device {id: $fromId}), (end:Device {id: $toId}),
      p = allShortestPaths((start)-[:CONNECTED_TO*]-(end))
      WHERE ALL(r IN relationships(p) WHERE r.speed IS NOT NULL)
      WITH p, reduce(speedSum = 0, r in relationships(p) | speedSum + r.speed) as totalSpeed
      RETURN p, totalSpeed ORDER BY totalSpeed DESC LIMIT 1`,
      { fromId: from, toId: to }
    );


    if (result.records.length === 0) {
      return res.status(404).send({ error: 'Path not found.' });
    }

    const paths = result.records.map(record => {
      const segments = record.get('p').segments;
      return { segments };
    });


    const path = paths[0].segments.map(segment => ({
      from: segment.start.properties,
      to: segment.end.properties,
      relationship: segment.relationship.properties
    }));

    res.send({ path });
  } catch (error) {
    console.error('Error finding fastest path:', error);
    res.status(500).send(error);
  } finally {
    await session.close();
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});