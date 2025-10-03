// Shared in-memory storage (Note: This will reset on each cold start in serverless)
// For production, you'd want to use a database like Redis or MongoDB
let rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { 
      text: "", 
      lastSender: "", 
      status: {},
      uniqueUsers: new Set(),
      lastHeartbeat: {},
      timestamp: Date.now()
    };
  }
  return rooms[roomId];
}

function isRoomFull(room) {
  return room.uniqueUsers.size >= 2;
}

export default function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { room: roomId, client: clientId, lastTimestamp } = req.query;
  
  if (!roomId || !clientId) {
    return res.status(400).json({ error: 'Room ID and Client ID are required' });
  }

  try {
    const room = getOrCreateRoom(roomId);
    
    // Check if trying to join a full room
    if (!room.uniqueUsers.has(clientId) && isRoomFull(room)) {
      return res.status(429).json({ error: "Room is full", full: true });
    }
    
    // Add user to unique users set
    room.uniqueUsers.add(clientId);
    
    // Update heartbeat timestamp
    room.lastHeartbeat[clientId] = Date.now();

    // Convert Set to Array for JSON serialization
    const uniqueUsersArray = Array.from(room.uniqueUsers);

    // Check if there's new content since last timestamp
    const clientLastTimestamp = parseInt(lastTimestamp) || 0;
    const hasNewContent = room.timestamp > clientLastTimestamp;

    const response = {
      text: room.text,
      timestamp: room.timestamp,
      hasNewContent,
      uniqueUsers: uniqueUsersArray,
      userCount: uniqueUsersArray.length
    };

    // Send other user's status if available
    const otherClientId = Object.keys(room.status).find(k => k !== clientId);
    if (otherClientId && room.status[otherClientId]) {
      response.status = room.status[otherClientId];
    }

    res.status(200).json(response);

  } catch (error) {
    console.error('Error in recv API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}