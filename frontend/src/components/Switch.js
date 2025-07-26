import React from 'react';
import './Device.css';

const Switch = ({ onDragStart, id, isInInventory, ip }) => {
  return (
    <div
      className="device switch"
      draggable={isInInventory}
      onDragStart={isInInventory ? onDragStart : null}
    >
      {isInInventory ? (
        'Switch'
      ) : (
        <>
          <div>{id}</div>
          {ip && (
            <div className="details">
              <div>IP: {ip}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Switch;