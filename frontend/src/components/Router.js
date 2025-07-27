import React from 'react';
import './Device.css';

const Router = ({ onDragStart, id, isInInventory, interfaceIPs }) => {
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
          {interfaceIPs && Object.keys(interfaceIPs).length > 0 && (
            <div className="details router-details">
              <div><strong>Interface IPs:</strong></div>
              {Object.entries(interfaceIPs).map(([interfaceKey, ip], index) => {
                const targetDevice = interfaceKey.replace('to_', '');
                return (
                  <div key={interfaceKey} className="interface-ip">
                    eth{index + 1} → {targetDevice}: {ip}
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default Router;