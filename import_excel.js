const xlsx = require('xlsx');
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, 'dial112.db');

// Read the excel file
console.log('Reading Excel file...');
const workbook = xlsx.readFile('One Month Data.xlsx');
const sheetName = workbook.SheetNames[0];
const sheet = workbook.Sheets[sheetName];

// Get data starting from second row (index 1) which contains headers
const rawData = xlsx.utils.sheet_to_json(sheet, { range: 1 });

if (rawData.length === 0) {
    console.error("No data found in excel file!");
    process.exit(1);
}

// Connect to SQLite db
if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath); // Delete old db
}
const db = new Database(dbPath);

console.log('Creating new schema...');
db.exec(`
  CREATE TABLE emergency_calls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT,
    district TEXT,
    police_station TEXT,
    caller_mobile TEXT,
    caller_name TEXT,
    timestamp DATETIME,
    call_date TEXT,
    call_time TEXT,
    incident_type TEXT,
    sub_type TEXT,
    brief_facts TEXT,
    erv_call_sign TEXT,
    assigned_time DATETIME,
    action_start_time DATETIME,
    reach_time DATETIME,
    response_time_str TEXT,
    response_time_mins REAL,
    hold_time_str TEXT,
    location TEXT,
    latitude REAL,
    longitude REAL,
    action_taken TEXT,
    closure_remarks TEXT,
    status TEXT,
    severity TEXT
  );
`);

console.log(`Importing ${rawData.length} rows of real data...`);

const insertQuery = db.prepare(`
  INSERT INTO emergency_calls (
    event_id, district, police_station, caller_mobile, caller_name,
    timestamp, call_date, call_time, incident_type, sub_type,
    brief_facts, erv_call_sign, assigned_time, action_start_time,
    reach_time, response_time_str, response_time_mins, hold_time_str,
    location, latitude, longitude, action_taken, closure_remarks, 
    status, severity
  ) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
  )
`);

const insertMany = db.transaction((rows) => {
    for (const row of rows) {
        // Exract fields
        const eventId = String(row['Event ID'] || '');
        const district = row['District'] || '';
        const policeStation = row['Police Station'] || '';
        const mobile = String(row['Mobile No of Caller'] || '');
        const callerName = row['Caller Name'] || '';

        // Dates & Times
        let callDate = row['Call Landing Date'] || '';
        const callTime = row['Call Landing Time'] || '';
        // Format call date properly to YYYY-MM-DD if needed.
        let timestamp = null;
        if (callDate && callTime) {
            if (callDate.includes('/')) {
                let parts = callDate.split('/');
                if (parts.length === 3 && parts[2].length === 4) {
                    callDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                }
            }
            timestamp = `${callDate} ${callTime}`;
        }

        const incidentType = row['Event Type'] || '';
        const subType = row['Event Sub-Type'] || '';
        const briefFacts = row['Brief Facts'] || '';
        const callSign = row['ERV Call Sign'] || '';

        // Parse datetime fields
        const assignedTime = row['ERV Assigned Time'] || null;
        const actionStartTime = row['Action Start Time'] || null;
        const reachTime = row['ERV Reach Time'] || null;

        const responseTimeStr = row['ERV Response Time'] || '';
        let responseTimeMins = null;
        if (responseTimeStr && responseTimeStr.includes(':')) {
            const parts = responseTimeStr.split(':');
            if (parts.length >= 3) { // HH:MM:SS
                responseTimeMins = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + parseInt(parts[2], 10) / 60;
            }
        }

        const holdTimeStr = row['ERV Hold Time'] || '';
        const rawLocation = row['ERV Reach Location'] || '';

        // Extract long/lat from "76.8716139,29.9711621(Address)"
        let latitude = null;
        let longitude = null;
        let location = rawLocation;

        const locMatch = rawLocation.match(/^([0-9.]+),([0-9.]+)\(([\s\S]*)\)$/);
        if (locMatch) {
            longitude = parseFloat(locMatch[1]);
            latitude = parseFloat(locMatch[2]);
            location = locMatch[3].replace(/[\r\n]+/g, ' ').trim();
        }

        const actionTaken = row['Action Taken Report'] || '';
        const closureRemarks = row['Event Closure Remarks'] || '';

        // Compute basic status and severity based on some heuristics
        let status = 'In Progress';
        if (closureRemarks.includes('SERVICE PROVIDED') || closureRemarks.includes('OTHERS')) {
            status = 'Resolved';
        } else if (closureRemarks.includes('DUPLICATE') || closureRemarks.includes('FALSE ALARM')) {
            status = 'False Alarm';
        } else if (closureRemarks || actionTaken) {
            status = 'Resolved'; // if closed/addressed
        }

        let severity = 'Low';
        if (incidentType) {
            const typeUpper = incidentType.toUpperCase();
            if (typeUpper.includes('MURDER') || typeUpper.includes('RAPE') || typeUpper.includes('ROBBERY') || typeUpper.includes('FIRE') || typeUpper.includes('KIDNAPPING') || typeUpper.includes('BOMB') || typeUpper.includes('THREAT') || typeUpper.includes('ACCIDENT')) {
                severity = 'Critical';
            } else if (typeUpper.includes('DISPUTE') || typeUpper.includes('THEFT') || typeUpper.includes('SUICIDE') || typeUpper.includes('ASSAULT')) {
                severity = 'High';
            } else if (typeUpper.includes('TRAFFIC') || typeUpper.includes('NUISANCE') || typeUpper.includes('POLLUTION') || typeUpper.includes('ANIMAL')) {
                severity = 'Medium';
            }
        }

        insertQuery.run(
            eventId, district, policeStation, mobile, callerName,
            timestamp, callDate, callTime, incidentType, subType,
            briefFacts, callSign, assignedTime, actionStartTime,
            reachTime, responseTimeStr, responseTimeMins, holdTimeStr,
            location, latitude, longitude, actionTaken, closureRemarks,
            status, severity
        );
    }
});

insertMany(rawData);
console.log('✅ Real data successfully imported from Excel!');

// Compute database stats to verify
const rowCount = db.prepare('SELECT COUNT(*) as count FROM emergency_calls').get().count;
console.log(`Total records loaded: ${rowCount}`);

const activeCalls = db.prepare(`SELECT COUNT(*) as count FROM emergency_calls WHERE status IN ('In Progress', 'Received', 'Dispatched')`).get().count;
console.log(`Running/Active calls: ${activeCalls}`);

const criticalCount = db.prepare(`SELECT COUNT(*) as count FROM emergency_calls WHERE severity = 'Critical'`).get().count;
console.log(`Critical severity calls: ${criticalCount}`);

const solvedCount = db.prepare(`SELECT COUNT(*) as count FROM emergency_calls WHERE status = 'Resolved' OR status = 'Closed'`).get().count;
console.log(`Resolved calls: ${solvedCount}`);

db.close();
