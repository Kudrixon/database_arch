import React from 'react';
import './Device.css';

const Router = ({ onDragStart, id, isInInventory }) => {
  return (
    <div
      className="device router"
      draggable={isInInventory}
      onDragStart={isInInventory ? onDragStart : null}
    >
      {isInInventory ? 'Router' : id}
    </div>
  );
};

export default Router;
