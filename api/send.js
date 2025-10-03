// In-memory storage (Note: This will reset on each cold start in serverless)
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

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { room: roomId, client: clientId } = req.query;
  
  if (!roomId || !clientId) {
    return res.status(400).json({ error: 'Room ID and Client ID are required' });
  }

  try {
    const room = getOrCreateRoom(roomId);
    
    // Add user to unique users set (convert to array for JSON serialization)
    room.uniqueUsers.add(clientId);
    
    // Update heartbeat timestamp
    room.lastHeartbeat[clientId] = Date.now();

    // Update text if provided
    if (req.body.text !== undefined) {
      room.text = req.body.text;
      room.lastSender = clientId;
      room.timestamp = Date.now();
    }

    // Update status
    if (req.body.status) {
      room.status[clientId] = req.body.status;
    }

    // Return success response
    res.status(200).json({ 
      success: true,
      message: 'Message sent successfully',
      timestamp: room.timestamp
    });

  } catch (error) {
    console.error('Error in send API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}