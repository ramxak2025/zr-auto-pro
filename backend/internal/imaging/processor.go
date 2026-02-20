package imaging

import (
	"fmt"
	"image/jpeg"
	"os"
	"path/filepath"

	"github.com/disintegration/imaging"
)

const (
	MaxWidth     = 1200
	ThumbWidth   = 400
	JPEGQuality  = 82
	ThumbQuality = 72
)

// ProcessResult holds paths to generated image variants.
type ProcessResult struct {
	Optimized string // filename of optimized JPEG
	Thumbnail string // filename of thumbnail JPEG
}

// Process takes an uploaded image, resizes it and generates a thumbnail.
// Pure Go — no CGO, no libvips required.
func Process(srcPath, uploadDir, baseName string) (*ProcessResult, error) {
	src, err := imaging.Open(srcPath, imaging.AutoOrientation(true))
	if err != nil {
		return nil, fmt.Errorf("open image: %w", err)
	}

	bounds := src.Bounds()
	origWidth := bounds.Dx()

	// --- Optimized version (max 1200px wide, JPEG) ---
	optimized := src
	if origWidth > MaxWidth {
		optimized = imaging.Resize(src, MaxWidth, 0, imaging.Lanczos)
	}

	optName := baseName + ".jpg"
	optPath := filepath.Join(uploadDir, optName)
	optFile, err := os.Create(optPath)
	if err != nil {
		return nil, fmt.Errorf("create optimized file: %w", err)
	}
	if err := jpeg.Encode(optFile, optimized, &jpeg.Options{Quality: JPEGQuality}); err != nil {
		optFile.Close()
		return nil, fmt.Errorf("encode optimized: %w", err)
	}
	optFile.Close()

	// --- Thumbnail (400px wide, JPEG) ---
	thumbW := ThumbWidth
	if origWidth < thumbW {
		thumbW = origWidth
	}
	thumb := imaging.Resize(src, thumbW, 0, imaging.Lanczos)

	thumbName := baseName + "_thumb.jpg"
	thumbPath := filepath.Join(uploadDir, thumbName)
	thumbFile, err := os.Create(thumbPath)
	if err != nil {
		return nil, fmt.Errorf("create thumbnail file: %w", err)
	}
	if err := jpeg.Encode(thumbFile, thumb, &jpeg.Options{Quality: ThumbQuality}); err != nil {
		thumbFile.Close()
		return nil, fmt.Errorf("encode thumbnail: %w", err)
	}
	thumbFile.Close()

	return &ProcessResult{
		Optimized: optName,
		Thumbnail: thumbName,
	}, nil
}
