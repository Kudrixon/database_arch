import React from 'react';
import './Device.css';

const Switch = ({ onDragStart, id, isInInventory }) => {
  return (
    <div
      className="device switch"
      draggable={isInInventory}
      onDragStart={isInInventory ? onDragStart : null}
    >
      {isInInventory ? 'Switch' : id}
    </div>
  );
};

export default Switch;
