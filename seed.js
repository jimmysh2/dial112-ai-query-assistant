const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'dial112.db'));

// Enable WAL mode for better performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  DROP TABLE IF EXISTS emergency_calls;
  DROP TABLE IF EXISTS responders;
  DROP TABLE IF EXISTS districts;

  CREATE TABLE districts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    zone TEXT NOT NULL,
    state TEXT NOT NULL
  );

  CREATE TABLE responders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    badge_number TEXT UNIQUE NOT NULL,
    designation TEXT NOT NULL,
    district_id INTEGER REFERENCES districts(id),
    status TEXT DEFAULT 'available' CHECK(status IN ('available', 'on_duty', 'off_duty'))
  );

  CREATE TABLE emergency_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    caller_name TEXT NOT NULL,
    caller_phone TEXT NOT NULL,
    location TEXT NOT NULL,
    district_id INTEGER REFERENCES districts(id),
    latitude REAL,
    longitude REAL,
    incident_type TEXT NOT NULL CHECK(incident_type IN (
      'Road Accident', 'Fire', 'Medical Emergency', 'Crime',
      'Domestic Violence', 'Theft', 'Kidnapping', 'Natural Disaster',
      'Public Disturbance', 'Missing Person', 'Animal Attack', 'Other'
    )),
    severity TEXT NOT NULL CHECK(severity IN ('Low', 'Medium', 'High', 'Critical')),
    description TEXT,
    status TEXT DEFAULT 'Received' CHECK(status IN (
      'Received', 'Dispatched', 'In Progress', 'Resolved', 'Closed', 'False Alarm'
    )),
    responder_id INTEGER REFERENCES responders(id),
    response_time_minutes INTEGER,
    resolution_time_minutes INTEGER,
    timestamp DATETIME NOT NULL,
    resolved_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX idx_calls_timestamp ON emergency_calls(timestamp);
  CREATE INDEX idx_calls_incident_type ON emergency_calls(incident_type);
  CREATE INDEX idx_calls_severity ON emergency_calls(severity);
  CREATE INDEX idx_calls_status ON emergency_calls(status);
  CREATE INDEX idx_calls_district ON emergency_calls(district_id);
`);

// Seed districts
const districts = [
  { name: 'Lucknow', zone: 'Central', state: 'Uttar Pradesh' },
  { name: 'Kanpur', zone: 'Central', state: 'Uttar Pradesh' },
  { name: 'Varanasi', zone: 'East', state: 'Uttar Pradesh' },
  { name: 'Agra', zone: 'West', state: 'Uttar Pradesh' },
  { name: 'Prayagraj', zone: 'East', state: 'Uttar Pradesh' },
  { name: 'Meerut', zone: 'West', state: 'Uttar Pradesh' },
  { name: 'Gorakhpur', zone: 'East', state: 'Uttar Pradesh' },
  { name: 'Noida', zone: 'West', state: 'Uttar Pradesh' },
  { name: 'Jhansi', zone: 'South', state: 'Uttar Pradesh' },
  { name: 'Bareilly', zone: 'North', state: 'Uttar Pradesh' },
];

const insertDistrict = db.prepare('INSERT INTO districts (name, zone, state) VALUES (?, ?, ?)');
for (const d of districts) {
  insertDistrict.run(d.name, d.zone, d.state);
}

// Seed responders
const designations = ['SI', 'ASI', 'Constable', 'Head Constable', 'Inspector'];
const firstNames = ['Rajesh', 'Amit', 'Sunita', 'Priya', 'Vikram', 'Deepak', 'Neha', 'Sanjay', 'Kavita', 'Ravi',
  'Anita', 'Manoj', 'Pooja', 'Suresh', 'Rekha', 'Arun', 'Geeta', 'Rahul', 'Meena', 'Ajay'];
const lastNames = ['Kumar', 'Singh', 'Sharma', 'Verma', 'Yadav', 'Gupta', 'Mishra', 'Pandey', 'Tiwari', 'Dubey'];

const insertResponder = db.prepare(
  'INSERT INTO responders (name, badge_number, designation, district_id, status) VALUES (?, ?, ?, ?, ?)'
);

const statuses = ['available', 'on_duty', 'off_duty'];
for (let i = 0; i < 40; i++) {
  const name = `${firstNames[i % firstNames.length]} ${lastNames[i % lastNames.length]}`;
  const badge = `UP${String(1000 + i).padStart(4, '0')}`;
  const designation = designations[i % designations.length];
  const districtId = (i % districts.length) + 1;
  const status = statuses[i % statuses.length];
  insertResponder.run(name, badge, designation, districtId, status);
}

// Seed emergency calls
const callerFirstNames = [
  'Aarav', 'Vivaan', 'Aditya', 'Vihaan', 'Arjun', 'Reyansh', 'Mohammed', 'Sai', 'Arnav', 'Dhruv',
  'Ishita', 'Saanvi', 'Ananya', 'Pari', 'Aanya', 'Myra', 'Diya', 'Kiara', 'Aadhya', 'Riya',
  'Harsh', 'Yash', 'Karan', 'Rohit', 'Nikhil', 'Aditi', 'Shreya', 'Pallavi', 'Swati', 'Nisha'
];
const callerLastNames = ['Agarwal', 'Bajaj', 'Chauhan', 'Dwivedi', 'Dubey', 'Gupta', 'Jain', 'Kapoor', 'Malhotra', 'Nair',
  'Patel', 'Rao', 'Saxena', 'Thakur', 'Upadhyay', 'Varma', 'Yadav', 'Singh', 'Sharma', 'Mishra'];

const incidentTypes = [
  'Road Accident', 'Fire', 'Medical Emergency', 'Crime',
  'Domestic Violence', 'Theft', 'Kidnapping', 'Natural Disaster',
  'Public Disturbance', 'Missing Person', 'Animal Attack', 'Other'
];
const severities = ['Low', 'Medium', 'High', 'Critical'];
const callStatuses = ['Received', 'Dispatched', 'In Progress', 'Resolved', 'Closed', 'False Alarm'];

const locations = {
  1: ['Hazratganj', 'Gomti Nagar', 'Aminabad', 'Charbagh', 'Aliganj', 'Indira Nagar', 'Mahanagar', 'Rajajipuram'],
  2: ['Swaroop Nagar', 'Kidwai Nagar', 'Kakadeo', 'Civil Lines', 'Harsh Nagar', 'Govind Nagar'],
  3: ['Dashashwamedh Ghat', 'Lanka', 'Assi Ghat', 'Godowlia', 'Sigra', 'Cantonment'],
  4: ['Taj Ganj', 'Sadar Bazaar', 'Kamla Nagar', 'Shahganj', 'Sikandra', 'Fatehabad Road'],
  5: ['Civil Lines', 'Naini', 'Jhunsi', 'Daraganj', 'Mumfordganj', 'George Town'],
  6: ['Sadar Bazaar', 'Shastri Nagar', 'Pallavpuram', 'Modipuram', 'Begumpul'],
  7: ['Golghar', 'Shahpur', 'Gorakhnath', 'Rapti Nagar', 'Medical College Road'],
  8: ['Sector 18', 'Sector 62', 'Sector 15', 'Sector 44', 'Greater Noida West', 'Sector 137'],
  9: ['Sipri Bazaar', 'Sadar Bazaar', 'Civil Lines', 'Narayan Bagh', 'Elite Chowk'],
  10: ['Civil Lines', 'Rajendra Nagar', 'Prem Nagar', 'Satellite Town', 'Izzat Nagar']
};

const descriptions = {
  'Road Accident': [
    'Two-wheeler collision with truck on main road',
    'Car hit a divider, driver injured',
    'Multi-vehicle pileup due to fog',
    'Pedestrian hit by speeding vehicle',
    'Auto-rickshaw overturned near crossing',
    'Bus and car collision at intersection'
  ],
  'Fire': [
    'Fire broke out in residential building',
    'Shop caught fire in market area',
    'Electrical short circuit caused fire in godown',
    'Fire in slum area, multiple huts affected',
    'Kitchen fire in apartment complex'
  ],
  'Medical Emergency': [
    'Elderly person collapsed, needs ambulance',
    'Heart attack victim needs immediate help',
    'Pregnant woman in labor, needs hospital transport',
    'Child having severe allergic reaction',
    'Snake bite victim needs anti-venom'
  ],
  'Crime': [
    'Armed robbery at jewellery shop',
    'Chain snatching incident reported',
    'Group fight at public place',
    'Extortion threat received by shopkeeper',
    'Suspicious activity near bank ATM'
  ],
  'Domestic Violence': [
    'Woman being assaulted by husband',
    'Elderly parents beaten by son',
    'Dowry harassment complaint',
    'Noise and screaming from neighbor house',
    'Threats being made by in-laws'
  ],
  'Theft': [
    'Mobile phone snatched on road',
    'Burglary in locked house',
    'Vehicle stolen from parking',
    'Pickpocketing at railway station',
    'Laptop stolen from office'
  ],
  'Kidnapping': [
    'Child missing from school premises',
    'Man forced into vehicle by unknown persons',
    'Minor girl abducted by neighbor',
    'Businessman kidnapped for ransom'
  ],
  'Natural Disaster': [
    'Flooding in low-lying area after heavy rain',
    'Building wall collapsed due to heavy rain',
    'Tree fallen on road blocking traffic',
    'Waterlogging in residential area'
  ],
  'Public Disturbance': [
    'Loud music and party late at night',
    'Religious procession creating traffic jam',
    'Drunk individuals creating nuisance',
    'Unauthorized construction causing dispute'
  ],
  'Missing Person': [
    'Elderly man with Alzheimer wandered off',
    'Teenager not returned home since morning',
    'Tourist lost in old city area',
    'Mental health patient escaped facility'
  ],
  'Animal Attack': [
    'Stray dog attacking people in colony',
    'Monkey menace in residential area',
    'Snake spotted in housing society',
    'Leopard sighted near village outskirts'
  ],
  'Other': [
    'Suspicious unattended bag found',
    'Power line fallen on road',
    'Gas leak in residential area',
    'Abandoned vehicle blocking road'
  ]
};

function randomDate(start, end) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function randomElement(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randomPhone() {
  return `+91${Math.floor(7000000000 + Math.random() * 2999999999)}`;
}

const insertCall = db.prepare(`
  INSERT INTO emergency_calls (
    caller_name, caller_phone, location, district_id, latitude, longitude,
    incident_type, severity, description, status, responder_id,
    response_time_minutes, resolution_time_minutes, timestamp, resolved_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const startDate = new Date('2025-01-01');
const endDate = new Date('2026-03-06');

// Generate ~500 emergency calls
const insertMany = db.transaction(() => {
  for (let i = 0; i < 500; i++) {
    const districtId = Math.floor(Math.random() * districts.length) + 1;
    const callerName = `${randomElement(callerFirstNames)} ${randomElement(callerLastNames)}`;
    const phone = randomPhone();
    const location = randomElement(locations[districtId]);
    const lat = 25.0 + Math.random() * 4;
    const lng = 78.0 + Math.random() * 5;
    const incidentType = randomElement(incidentTypes);
    
    // Weight severity - more medium/high, fewer critical
    const sevWeights = [0.2, 0.35, 0.3, 0.15];
    const sevRand = Math.random();
    let sevIdx = 0;
    let cumulative = 0;
    for (let s = 0; s < sevWeights.length; s++) {
      cumulative += sevWeights[s];
      if (sevRand < cumulative) { sevIdx = s; break; }
    }
    const severity = severities[sevIdx];

    const description = randomElement(descriptions[incidentType]);
    
    // Weight status - most should be resolved/closed for historical data
    const statusWeights = [0.05, 0.05, 0.1, 0.4, 0.35, 0.05];
    const statusRand = Math.random();
    let statusIdx = 0;
    cumulative = 0;
    for (let s = 0; s < statusWeights.length; s++) {
      cumulative += statusWeights[s];
      if (statusRand < cumulative) { statusIdx = s; break; }
    }
    const status = callStatuses[statusIdx];

    const responderId = Math.floor(Math.random() * 40) + 1;
    const responseTime = Math.floor(5 + Math.random() * 55); // 5-60 min
    const resolutionTime = status === 'Resolved' || status === 'Closed'
      ? responseTime + Math.floor(15 + Math.random() * 180) // 15-195 more min
      : null;

    const timestamp = randomDate(startDate, endDate);
    const resolvedAt = resolutionTime
      ? new Date(timestamp.getTime() + resolutionTime * 60000)
      : null;

    insertCall.run(
      callerName, phone, location, districtId, 
      parseFloat(lat.toFixed(6)), parseFloat(lng.toFixed(6)),
      incidentType, severity, description, status, responderId,
      responseTime, resolutionTime,
      timestamp.toISOString().replace('T', ' ').slice(0, 19),
      resolvedAt ? resolvedAt.toISOString().replace('T', ' ').slice(0, 19) : null
    );
  }
});

insertMany();

// Print summary
const totalCalls = db.prepare('SELECT COUNT(*) as count FROM emergency_calls').get();
const byType = db.prepare('SELECT incident_type, COUNT(*) as count FROM emergency_calls GROUP BY incident_type ORDER BY count DESC').all();
const bySeverity = db.prepare('SELECT severity, COUNT(*) as count FROM emergency_calls GROUP BY severity ORDER BY count DESC').all();
const byDistrict = db.prepare('SELECT d.name, COUNT(*) as count FROM emergency_calls e JOIN districts d ON e.district_id = d.id GROUP BY d.name ORDER BY count DESC').all();

console.log('✅ Database seeded successfully!\n');
console.log(`Total emergency calls: ${totalCalls.count}`);
console.log('\n📊 By Incident Type:');
byType.forEach(r => console.log(`  ${r.incident_type}: ${r.count}`));
console.log('\n🔴 By Severity:');
bySeverity.forEach(r => console.log(`  ${r.severity}: ${r.count}`));
console.log('\n📍 By District:');
byDistrict.forEach(r => console.log(`  ${r.name}: ${r.count}`));

db.close();
console.log('\n✅ Database ready at: dial112.db');
