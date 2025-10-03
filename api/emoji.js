// Shared in-memory storage (Note: This will reset on each cold start in serverless)
let rooms = {};

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = { 
      text: "", 
      lastSender: "", 
      status: {},
      uniqueUsers: new Set(),
      lastHeartbeat: {},
      timestamp: Date.now(),
      lastEmoji: null,
      emojiTimestamp: Date.now()
    };
  }
  return rooms[roomId];
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

  const { room: roomId, client: clientId } = req.query;
  
  if (!roomId || !clientId) {
    return res.status(400).json({ error: 'Room ID and Client ID are required' });
  }

  try {
    const room = getOrCreateRoom(roomId);
    
    if (req.method === 'POST') {
      const { emoji } = req.body;
      
      if (!emoji) {
        return res.status(400).json({ error: 'Emoji is required' });
      }

      // Add user to unique users set
      room.uniqueUsers.add(clientId);
      
      // Store emoji
      room.lastEmoji = emoji;
      room.emojiTimestamp = Date.now();
      room.emojiSender = clientId;

      res.status(200).json({ 
        success: true,
        message: 'Emoji sent successfully',
        timestamp: room.emojiTimestamp
      });

    } else if (req.method === 'GET') {
      // Get emoji updates
      const { lastEmojiTimestamp } = req.query;
      const clientLastEmojiTimestamp = parseInt(lastEmojiTimestamp) || 0;
      
      // Add user to unique users set
      room.uniqueUsers.add(clientId);
      
      const response = {
        emoji: room.lastEmoji,
        emojiTimestamp: room.emojiTimestamp,
        hasNewEmoji: room.emojiTimestamp > clientLastEmojiTimestamp && room.emojiSender !== clientId
      };

      res.status(200).json(response);
    } else {
      res.status(405).json({ error: 'Method not allowed' });
    }

  } catch (error) {
    console.error('Error in emoji API:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}