package config

import (
	"os"

	"github.com/spf13/viper"
)

type Config struct {
	APIURL     string        `mapstructure:"api_url"`
	ScannerURL string        `mapstructure:"scanner_url"`
	Build      BuildConfig   `mapstructure:"build"`
	Deploy     DeployConfig  `mapstructure:"deploy"`
	Monitor    MonitorConfig `mapstructure:"monitor"`
}

type BuildConfig struct {
	CgoEnabled string   `mapstructure:"cgo_enabled"`
	Goos       string   `mapstructure:"goos"`
	Goarch     string   `mapstructure:"goarch"`
	Output     string   `mapstructure:"output"`
	Source     string   `mapstructure:"source"`
	ExtraFlags []string `mapstructure:"extra_flags"`
}

type DeployConfig struct {
	PinggyToken  string `mapstructure:"pinggy_token"`
	TargetPort   int    `mapstructure:"target_port"`
	TunnelRegion string `mapstructure:"tunnel_region"`
}

type MonitorConfig struct {
	PollIntervalMs int             `mapstructure:"poll_interval_ms"`
	LogLinesBuffer int             `mapstructure:"log_lines_buffer"`
	Services       []ServiceConfig `mapstructure:"services"`
}

type ServiceConfig struct {
	Name      string `mapstructure:"name"`
	URL       string `mapstructure:"url"`
	Check     string `mapstructure:"check"`
	Container string `mapstructure:"container"`
}

func Load(customPath string) (*Config, error) {
	if customPath != "" {
		viper.SetConfigFile(customPath)
	} else {
		viper.SetConfigName(".snapflow")
		viper.SetConfigType("yaml")
		viper.AddConfigPath(".")
		home, err := os.UserHomeDir()
		if err == nil {
			viper.AddConfigPath(home)
		}
	}

	// Set defaults
	viper.SetDefault("api_url", "http://localhost:8080")
	viper.SetDefault("scanner_url", "http://localhost:8081")

	var cfg Config
	err := viper.ReadInConfig()
	if err != nil {
		// Return default config on read error
		if err := viper.Unmarshal(&cfg); err != nil {
			return nil, err
		}
		return &cfg, err
	}

	if err := viper.Unmarshal(&cfg); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func (c *Config) Validate() []string {
	var errs []string
	if c.APIURL == "" {
		errs = append(errs, "api_url is required")
	}
	if c.ScannerURL == "" {
		errs = append(errs, "scanner_url is required")
	}
	return errs
}
