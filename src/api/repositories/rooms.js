export function createRoomRepository({ database }) {
  const selectRooms = database.prepare('SELECT room_id FROM rooms ORDER BY room_id');
  const selectRoom = database.prepare('SELECT room_id FROM rooms WHERE room_id = ?');
  return {
    findAll() {
      return selectRooms.all().map((room) => ({ ...room }));
    },
    findById(roomId) {
      const room = selectRoom.get(roomId);
      return room ? { ...room } : null;
    },
  };
}
