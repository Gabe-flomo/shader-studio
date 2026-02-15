// @ts-nocheck — legacy file, unused in active app
import { useEffect } from 'react';
import { useControls, button, folder } from 'leva';
import { useShaderStore } from '../store/useShaderStore';

export default function ParameterPanel() {
  const selectedNodeId = useShaderStore((state) => state.selectedNodeId);
  const nodes = useShaderStore((state) => state.nodes);
  const updateNode = useShaderStore((state) => state.updateNode);
  const addModifier = useShaderStore((state) => state.addModifier);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);

  // Dynamic controls based on selected node
  const controls = useControls(
    () => {
      if (!selectedNode) {
        return {
          info: { value: 'No node selected', editable: false },
        };
      }

      const config: any = {
        nodeType: { value: selectedNode.type, editable: false },
      };

      // Add controls based on node type
      switch (selectedNode.type) {
        case 'circleSDF':
        case 'ringSDF':
          config.size = {
            value: selectedNode.params.size || 0.5,
            min: 0.1,
            max: 2.0,
            step: 0.01,
            onChange: (v: number) => updateNode(selectedNode.id, { size: v }),
          };
          config.positionX = {
            value: selectedNode.params.position?.[0] || 0,
            min: -1,
            max: 1,
            step: 0.01,
            onChange: (v: number) =>
              updateNode(selectedNode.id, {
                position: [v, selectedNode.params.position?.[1] || 0],
              }),
          };
          config.positionY = {
            value: selectedNode.params.position?.[1] || 0,
            min: -1,
            max: 1,
            step: 0.01,
            onChange: (v: number) =>
              updateNode(selectedNode.id, {
                position: [selectedNode.params.position?.[0] || 0, v],
              }),
          };
          break;

        case 'boxSDF':
          config.width = {
            value: selectedNode.params.dimensions?.[0] || 0.5,
            min: 0.1,
            max: 2.0,
            step: 0.01,
            onChange: (v: number) =>
              updateNode(selectedNode.id, {
                dimensions: [v, selectedNode.params.dimensions?.[1] || 0.5],
              }),
          };
          config.height = {
            value: selectedNode.params.dimensions?.[1] || 0.5,
            min: 0.1,
            max: 2.0,
            step: 0.01,
            onChange: (v: number) =>
              updateNode(selectedNode.id, {
                dimensions: [selectedNode.params.dimensions?.[0] || 0.5, v],
              }),
          };
          break;

        case 'smoothMin':
          config.smoothness = {
            value: selectedNode.params.smoothness || 0.5,
            min: 0.0,
            max: 2.0,
            step: 0.01,
            onChange: (v: number) => updateNode(selectedNode.id, { smoothness: v }),
          };
          break;

        case 'makeLight':
          config.brightness = {
            value: selectedNode.params.brightness || 5.0,
            min: 1.0,
            max: 20.0,
            step: 0.1,
            onChange: (v: number) => updateNode(selectedNode.id, { brightness: v }),
          };
          break;

        case 'palette':
          // Simplified palette controls (just showing one coefficient for now)
          config.palette = folder({
            d0: {
              value: selectedNode.params.d?.[0] || 0.0,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v: number) => {
                const d = selectedNode.params.d || [0, 0.33, 0.67];
                updateNode(selectedNode.id, { d: [v, d[1], d[2]] });
              },
            },
            d1: {
              value: selectedNode.params.d?.[1] || 0.33,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v: number) => {
                const d = selectedNode.params.d || [0, 0.33, 0.67];
                updateNode(selectedNode.id, { d: [d[0], v, d[2]] });
              },
            },
            d2: {
              value: selectedNode.params.d?.[2] || 0.67,
              min: 0,
              max: 1,
              step: 0.01,
              onChange: (v: number) => {
                const d = selectedNode.params.d || [0, 0.33, 0.67];
                updateNode(selectedNode.id, { d: [d[0], d[1], v] });
              },
            },
          });
          break;
      }

      // Modifiers section
      config.modifiers = folder({
        addSin: button(() => {
          addModifier(selectedNode.id, {
            id: `mod-${Date.now()}`,
            type: 'sin',
            params: { frequency: 1.0 },
          });
        }),
        addCos: button(() => {
          addModifier(selectedNode.id, {
            id: `mod-${Date.now()}`,
            type: 'cos',
            params: { frequency: 1.0 },
          });
        }),
        addAbs: button(() => {
          addModifier(selectedNode.id, {
            id: `mod-${Date.now()}`,
            type: 'abs',
            params: {},
          });
        }),
      });

      return config;
    },
    [selectedNode, selectedNodeId]
  );

  return null; // Leva renders its own UI
}
