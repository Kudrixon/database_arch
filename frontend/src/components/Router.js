import React from 'react';
import './Device.css';

const Router = ({ onDragStart, id, isInInventory, ip }) => {
  return (
    <div
      className="device router"
      draggable={isInInventory}
      onDragStart={isInInventory ? onDragStart : null}
    >
      {isInInventory ? (
        'Router'
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

export default Router;