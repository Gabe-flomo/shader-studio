/**
 * retiredExamples.ts — examples taken off the Examples lists by the curation
 * (docs/examples-curation-proposal.md, user feedback 2026-10-19), kept on purpose.
 *
 * Every one still opens by key (loadExampleGraph): the Present lessons, the Start
 * sheet, the Time Cube builder presets, What's new links (changelog/releases.ts),
 * the dev harness and the tests use them, and old links keep working. Course steps
 * are not here: they stay listed in their course folders (EXAMPLE_FOLDERS, `course`).
 *
 * An example added to EXAMPLE_INDEX must go in a folder, HIDDEN_EXAMPLE_KEYS or this
 * list (src/store/__tests__/examples.test.ts checks).
 */
export const RETIRED_EXAMPLE_KEYS: readonly string[] = [
  'gravitationalLens', 'chladniFieldQuickDemo', 'groupCarryFBM', 'groupCarryDomainWarp',
  'waveTextureDemo', 'magicTextureDemo', 'waveInterference', 'shapesAndGround3D', 'spiralWorld3D', 'softMetaballs3D',
  'neonFloorGrid', 'particleRain', 'tiltShiftScene', 'sdfPolarRepeat', 'sdfBend3D', 'sdCrossScene3D', 'infinitePillars3D',
  'gyroidWarped', 'glowMarcher', 'dofOrbitOrbs', 'fresnelSchlickRim', 'refractDirFakeGlass', 'glassPhysical',
  'giBoxFrame', 'gridMetaballs', 'gridBreathing', 'gridLavaLamp', 'gridNeighborDisplaced', 'echoTrails',
  'feedbackSmear', 'beatGrid', 'webcamCmyk', 'particlesIn3dScene', 'particleSoundField', 'particleFlowIntoShape',
  'particleCymatics3d', 'particleDustInAir', 'particleEmbers', 'particleImageDissolve', 'inkInWater', 'volumeGlowDemo',
  'normalColorDemo', 'lensBarrel', 'neonGlow', 'comboTurbulenceGlow', 'comboBloomDots', 'comboChaosStars',
  'comboBlurDirectional', 'learnShaping', 'learnShape', 'learnDistance', 'learnPalette', 'learnGrid', 'learnGridPattern',
  'learnGridSpread', 'curvedHyperbolic', 'curvedReverse', 'repeatSceneCentrepiece', 'curveTraceLive', 'curveTracePen',
  'curveTraceKnot', 'comboGridPaintShapes', 'comboGridPaintPictures', 'comboGridShapeByWire', 'comboArrayGroupMoons',
  'comboGridPaintGlow', 'matrixWhatItDoes', 'matrixCombineUndo', 'matrixColor', 'dataWeatherYear', 'dataScriptRings',
  'dataTypedStars', 'gridTourBuiltIn', 'gridTourByHand', 'gridTourMouseMorph', 'gridTourArrayInCells', 'gridTourArrayBlobs',
  'passEdgeGlow', 'passParticleEdges', 'passReactionDiffusion', 'passSlimeEdges', 'passBlurGroup', 'passShaderTextureFood',
  'agentBoids', 'agentStrands', 'agentGrowPicture', 'agentGalaxy', 'agentMycelium', 'agentSandPlate', 'agentShaderFeedback',
  'agentShaderOutlines', 'agentShaderSoundRings', 'agent3dFlock', 'agent3dVoxelSlime', 'agent3dCubeStorm',
  'agent3dReverse', 'simAgentPredatorPrey', 'simAgentDla', 'simAgentCrowd', 'simAgentPainters', 'simAgentTermites',
  'simAgentFireflies', 'simAgentInfection', 'agentRidePath', 'agentRideMorph', 'agentRuleSlime', 'convertCircle',
  'convertCircleOptimised', 'convertTunnel', 'loopJulia', 'loopFbm', 'timeCubeFlow', 'timeCubePulse', 'timeCubeFlyThrough',
  'timeCubeLongExposure', 'timeCubeKey', 'timeCubeTwisted', 'timeCubeTrain', 'timeCubeSceneSpace', 'frameStackDrift',
  'frameStackHighlights', 'fourDTesseractSlice', 'fourDThreeSlices', 'fourDDuocylinderDance', 'fourD24Cell',
  'fourDCliffordTorus', 'fourDLattice', 'fourDShapeGallery', 'fourD24CellWireframe', 'fourDDuocylinderShadow',
  'fourDPlaneSlice', 'ttVideoOutline', 'ttMotionTrails', 'ttTrailFlow', 'ttColourKey', 'ttReactionLevels',
  'ttGrowShrink', 'ttFeedbackFlow', 'ttFeedbackCamera', 'ttBlobTrack', 'ttCacheTimeRgb', 'ttBlob3d', 'ttSegmentClick',
  'ttDeepGlow', 'ttDisplaceNoise', 'picShuffle', 'picChannelColours', 'picShowData', 'picBlockSwap', 'picThreshold',
  'pic3dCutouts', 'pic3dTexturedShapes', 'audioKickRing', 'audioSpectrumBars', 'audioWaterfall', 'audioLearnClap',
  'audioScope', 'audioFilterSweep', 'audioResonatorRings', 'audioSpectralFreeze', 'audioSpectrogramField',
  'audioHitBand', 'raysColourBurst', 'sbBlobSculpture', 'sb2Orbits', 'sb2MouseGrid', 'sb2DepthSize', 'simGridLife',
  'simGridLifeLike', 'simGridBrain', 'simGridWater', 'simGridHeat', 'simGridFire', 'simGridSand', 'simGridWire',
  'gridRulesLifeLike', 'gridRulesBrain', 'gridRulesCave', 'gridRulesHeat', 'gridRulesFire', 'gridRulesSand',
  'gridRulesCrystal', 'gridRulesGas', 'agentRulesBoids', 'agentRulesSir', 'agentRulesTermites', 'agentRulesFireflies',
  'agentRulesParticles', 'agentRulesCrowd', 'agentRulesScan',
  // Not retired but not in a folder either (each folder holds its curated five): Simple Expression's own example,
  // shown under the node in the node list (Used in) and opened by key.
  'simpleExprBlend',
];
