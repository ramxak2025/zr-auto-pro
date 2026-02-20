package imaging

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/h2non/bimg"
)

const (
	MaxWidth      = 1200
	ThumbWidth    = 400
	WebPQuality   = 80
	ThumbQuality  = 70
)

// ProcessResult holds paths to generated image variants.
type ProcessResult struct {
	Optimized string // path to optimized WebP
	Thumbnail string // path to thumbnail WebP
}

// Process takes an uploaded file, converts it to WebP with resize,
// and generates a thumbnail. Returns paths relative to uploadDir.
func Process(srcPath, uploadDir, baseName string) (*ProcessResult, error) {
	buf, err := os.ReadFile(srcPath)
	if err != nil {
		return nil, fmt.Errorf("read source: %w", err)
	}

	// Detect original dimensions
	size, err := bimg.NewImage(buf).Size()
	if err != nil {
		return nil, fmt.Errorf("read image size: %w", err)
	}

	// --- Optimized version (max 1200px wide, WebP) ---
	optWidth := size.Width
	if optWidth > MaxWidth {
		optWidth = MaxWidth
	}

	optimized, err := bimg.NewImage(buf).Process(bimg.Options{
		Width:   optWidth,
		Type:    bimg.WEBP,
		Quality: WebPQuality,
	})
	if err != nil {
		return nil, fmt.Errorf("optimize image: %w", err)
	}

	optName := baseName + ".webp"
	optPath := filepath.Join(uploadDir, optName)
	if err := os.WriteFile(optPath, optimized, 0644); err != nil {
		return nil, fmt.Errorf("write optimized: %w", err)
	}

	// --- Thumbnail (400px wide, WebP) ---
	thumbWidth := ThumbWidth
	if size.Width < thumbWidth {
		thumbWidth = size.Width
	}

	thumb, err := bimg.NewImage(buf).Process(bimg.Options{
		Width:   thumbWidth,
		Type:    bimg.WEBP,
		Quality: ThumbQuality,
	})
	if err != nil {
		return nil, fmt.Errorf("create thumbnail: %w", err)
	}

	thumbName := baseName + "_thumb.webp"
	thumbPath := filepath.Join(uploadDir, thumbName)
	if err := os.WriteFile(thumbPath, thumb, 0644); err != nil {
		return nil, fmt.Errorf("write thumbnail: %w", err)
	}

	return &ProcessResult{
		Optimized: optName,
		Thumbnail: thumbName,
	}, nil
}
