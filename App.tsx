import React, {useState} from 'react';
import {HomeScreen} from './src/screens/HomeScreen';
import {RoomPreviewScreen} from './src/screens/RoomPreviewScreen';
import type {RoomModel} from './src/domain/room';

export default function App() {
  const [previewRoom, setPreviewRoom] = useState<RoomModel | null>(null);

  if (previewRoom) {
    return (
      <RoomPreviewScreen room={previewRoom} onBack={() => setPreviewRoom(null)} />
    );
  }

  return <HomeScreen onPreviewRoom={setPreviewRoom} />;
}
