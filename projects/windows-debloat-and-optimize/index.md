---
layout: default
title: Windows Debloat & Optimize
permalink: /projects/windows-debloat-and-optimize/
---

<div class="hub-links">
  <a href="{{ '/' | relative_url }}">[ Back to Home ]</a>
  <a href="{{ '/projects/' | relative_url }}">[ View Projects ]</a>
  <a href="{{ '/writeups/' | relative_url }}">[ View Writeups ]</a>
</div>


## Windows 10/11 Debloat & Optimize

**PowerShell \| Windows Internals \| Registry Tuning \| System Optimization \| Virtualization Testing**

Windows 10/11 Debloat & Optimize is an all-in-one PowerShell project built to automate post-install and post-update Windows cleanup, debloating, tuning, and quality-of-life configuration.

Built on top of the original **Windows10Debloater** project, this version expands the concept with additional optimization, networking, privacy, gaming, and general system tweaks. The goal is to reduce manual setup time and give users a cleaner, more controlled Windows experience after a reformat or major update.

The script was tested in a virtualized Windows environment with VMware before being used on host systems.

### Key Features
- Creates a System Restore point before major changes
- Runs DISM and SFC health and repair checks
- Removes common Windows bloatware and unnecessary AppX packages
- Applies registry-based system, explorer, keyboard, mouse, and service-related tweaks
- Includes gaming-focused changes such as GameDVR-related tuning, responsiveness adjustments, and network throttling-related tweaks
- Unparks CPU cores
- Disables AutoRun
- Applies TCP/network-related tweaks, including Nagle-related changes
- Changes DNS settings to Cloudflare
- Modifies the hosts file using a large blocklist with custom additions
- Includes additional privacy, cleanup, and general quality-of-life changes

### What This Project Demonstrates
- PowerShell scripting for real-world Windows automation
- Registry modification and system configuration management
- Practical Windows debloating and post-install workflow design
- Safe testing habits through virtualization before host deployment
- A hands-on approach to endpoint tuning, usability, and system control

### Notes
This is an opinionated tuning script intended for users who want more control over Windows behavior. Some changes are aggressive by design, so the project is best presented as a practical automation and tuning tool rather than a guaranteed performance booster.

<a href="https://github.com/su-Alexis/w10n11debloat-optimize" target="_blank" rel="noopener noreferrer">[ View Repository ]</a>

### Screenshots

## Screenshots

<div class="screenshot-gallery">
  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptstart.png' | relative_url }}" onclick="openLightbox(this.href, 'Main Script Start'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptstart.png' | relative_url }}" alt="Main Script Start">
    </a>
    <figcaption>Main Script Start</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptbloatremoval.png' | relative_url }}" onclick="openLightbox(this.href, 'Bloat Removal'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptbloatremoval.png' | relative_url }}" alt="Bloat Removal">
    </a>
    <figcaption>Bloat Removal</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptdisablingscheduledtasks.png' | relative_url }}" onclick="openLightbox(this.href, 'Disabling Scheduled Tasks'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptdisablingscheduledtasks.png' | relative_url }}" alt="Disabling Scheduled Tasks">
    </a>
    <figcaption>Disabling Scheduled Tasks</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptoptimizations.png' | relative_url }}" onclick="openLightbox(this.href, 'Optimizations'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptoptimizations.png' | relative_url }}" alt="Optimizations">
    </a>
    <figcaption>Optimizations</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptNetChanges.png' | relative_url }}" onclick="openLightbox(this.href, 'Net Changes'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptNetChanges.png' | relative_url }}" alt="Net Changes">
    </a>
    <figcaption>Net Changes</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptNetCleaner.png' | relative_url }}" onclick="openLightbox(this.href, 'Net Cleaner'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptNetCleaner.png' | relative_url }}" alt="Net Cleaner">
    </a>
    <figcaption>Net Cleaner</figcaption>
  </figure>

  <figure class="screenshot-tile">
    <a class="screenshot-link" href="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptend.png' | relative_url }}" onclick="openLightbox(this.href, 'Main Script End'); return false;">
      <img src="{{ '/assets/images/projects/windows-debloat-and-optimize/wdebloatscriptend.png' | relative_url }}" alt="Main Script End">
    </a>
    <figcaption>Main Script End</figcaption>
  </figure>
</div>
