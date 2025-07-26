import React from 'react';
import './Device.css';

const VM = ({ onDragStart, id, isInInventory, cpu, memory, storage, ip }) => {
  return (
    <div
      className="device vm"
      draggable={isInInventory}
      onDragStart={isInInventory ? onDragStart : null}
    >
      {isInInventory ? (
        'VM'
      ) : (
        <>
          <div>{id}</div>
          <div className="details">
            <div>CPU: {cpu}</div>
            <div>Memory: {memory}</div>
            <div>Storage: {storage}</div>
            {ip && <div>IP: {ip}</div>}
          </div>
        </>
      )}
    </div>
  );
};

export default VM;