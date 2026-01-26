const requireStage = (minStage) => {
  return (req, res, next) => {
    // req.user.stage comes from the DB (via authMiddleware)
    if (req.user.stage < minStage) {
      return res.status(403).json({ 
        msg: "Locked: You must complete previous steps first.", 
        current_stage: req.user.stage, 
        required_stage: minStage 
      });
    }
    next();
  };
};

module.exports = { requireStage };