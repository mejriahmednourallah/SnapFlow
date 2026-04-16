package state

import (
	"sync"
)

// StateController manages application and session state centrally
type StateController struct {
	mu   sync.RWMutex
	vars map[string]string
}

func NewStateController() *StateController {
	return &StateController{
		vars: make(map[string]string),
	}
}

// GetVar retrieves a value from the state controller with thread safety
func (c *StateController) GetVar(key string) string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.vars[key]
}

// SetVar updates a value in the state controller with thread safety
func (c *StateController) SetVar(key, value string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.vars[key] = value
}
