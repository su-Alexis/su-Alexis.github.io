// red-2: authored mission data for the web01 training incident.
// Export: RED_2. Install in data/missions/red-2.js.
// Requires the red-handoff-v1 consumer contract described in red-missions-integration.md.
// features/mission-engine.js enforces the objective and completion guards.
// This module does not execute commands, mutate guests, make requests, or grant rewards.
// Keep briefing, hints and command output here; share only the separate handoff card.

// Deep-freeze only this finite authored graph, never visitor input or stored objects.
function freezeData(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freezeData(child);
    Object.freeze(value);
  }
  return value;
}

export const RED_2 = freezeData({
  "id": "red-2",
  "ticket": "1044",
  "seat": "parrot01",
  "targets": [
    "web01"
  ],
  "title": "The restore nobody retired",
  "from": "Lab Ops",
  "durationMinutes": 10,
  "contract": "red-handoff-v1",
  "requires": [
    "m-red-1-done"
  ],
  "scenario": "web01",
  "provides": [
    "R2-a",
    "R2-b",
    "R2-c"
  ],
  "briefing": [
    "Red 1 found that SSH refused access, but the old maintenance feature remained exposed. Continue the same web01 incident from parrot01.",
    "Use the fixed training restore to demonstrate an unauthorized change to /status.txt through the exposed maintenance feature. Preview it, compare the before and after, and check that the home page still answers. The lab-restore helper is fictional and runs no real program.",
    "The trail is altered file content; this exercise creates no background process or persistence mechanism. Leave status.txt altered and public restore enabled for Blue to investigate. Do not reset the incident, alter access controls, or erase its trail."
  ],
  "startState": {
    "mode": "continue-run",
    "targetRunning": true,
    "state": {
      "status": "baseline",
      "publicRestore": "enabled"
    },
    "preserveEvidence": true,
    "requiresEvidence": [
      "e-web01-http-parrot01",
      "e-web01-maintenance-page-parrot01",
      "e-web01-ssh-existing-denied-admin-parrot01",
      "e-web01-ssh-invalid-denied-operator-parrot01"
    ]
  },
  "objectives": [
    {
      "id": "r2-scope",
      "text": "cat /home/operator/red-2-ticket.txt",
      "do": "cat /home/operator/red-2-ticket.txt",
      "see": "Scope, fixed restore fixture, preservation instructions.",
      "ticks": "Successful ticket read after Red 1.",
      "teaches": "Continue from the existing incident.",
      "dependsOn": [],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "parrot01"
        ],
        "commands": [
          "cat ~/red-2-ticket.txt"
        ]
      },
      "hints": [
        "Continue the assignment instead of resetting the server.",
        "Read the second ticket on parrot01.",
        "cat /home/operator/red-2-ticket.txt"
      ]
    },
    {
      "id": "r2-before",
      "text": "curl https://web01.lab.example/status.txt",
      "do": "curl https://web01.lab.example/status.txt",
      "see": "Baseline: operational, owned in the text by Lab Ops.",
      "ticks": "Successful read while the file is in its baseline state.",
      "teaches": "Capture a before-state before causing a change.",
      "dependsOn": [
        "r2-scope"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "curl https://web01.lab.example/status.txt"
        ],
        "evidence": [
          "e-web01-status-before-parrot01"
        ],
        "state": {
          "status": "baseline",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "Establish the current content first.",
        "The maintenance page names the status document.",
        "curl https://web01.lab.example/status.txt"
      ]
    },
    {
      "id": "r2-preview",
      "text": "lab-restore preview web01",
      "do": "lab-restore preview web01",
      "see": "Only status.txt would change; current and proposed content shown; no change applied.",
      "ticks": "Valid preview on the live target with public restore enabled.",
      "teaches": "Understand the exact effect before acting.",
      "dependsOn": [
        "r2-before"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "lab-restore preview web01"
        ],
        "state": {
          "status": "baseline",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "The lab lets you inspect the one permitted change.",
        "Use the restore helper's preview action.",
        "lab-restore preview web01"
      ]
    },
    {
      "id": "r2-apply",
      "text": "lab-restore apply web01",
      "do": "lab-restore apply web01",
      "see": "The exposed maintenance service changes status.txt without authenticating the requester. www-data is the service account that performs the change.",
      "ticks": "One atomic successful action updates R2-b and records R2-a.",
      "teaches": "A refused SSH login does not protect an unrelated application action.",
      "dependsOn": [
        "r2-preview"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "lab-restore apply web01"
        ],
        "evidence": [
          "e-web01-maintenance-restore-applied-parrot01"
        ],
        "state": {
          "status": "altered",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "Apply only the fixture you just inspected.",
        "The fixed helper has a separate apply action.",
        "lab-restore apply web01"
      ]
    },
    {
      "id": "r2-after",
      "text": "curl https://web01.lab.example/status.txt",
      "do": "curl https://web01.lab.example/status.txt",
      "see": "The content of status.txt now matches the proposed change in the preview.",
      "ticks": "Successful read of the altered fixture, after apply in this run.",
      "teaches": "Verify the unauthorized content change. This altered file does not establish persistent access.",
      "dependsOn": [
        "r2-apply"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "curl https://web01.lab.example/status.txt"
        ],
        "evidence": [
          "e-web01-status-after-parrot01"
        ],
        "state": {
          "status": "altered",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "Read the file again through the site.",
        "Compare all three lines with the before-state.",
        "curl https://web01.lab.example/status.txt"
      ]
    },
    {
      "id": "r2-health",
      "text": "curl -I https://web01.lab.example/",
      "do": "curl -I https://web01.lab.example/",
      "see": "HTTP 200 for the main site.",
      "ticks": "Successful HEAD after the change.",
      "teaches": "Distinguish an unauthorized content change from taking the service down.",
      "dependsOn": [
        "r2-after"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "curl -I https://web01.lab.example/"
        ],
        "evidence": [
          "e-web01-http-head-parrot01"
        ],
        "state": {
          "status": "altered",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "Check that the ordinary service is still available.",
        "Request only the home page's headers.",
        "curl -I https://web01.lab.example/"
      ]
    },
    {
      "id": "r2-auth-limit",
      "text": "ssh admin@web01",
      "do": "ssh admin@web01",
      "see": "Authentication still denied.",
      "ticks": "Expected authentication refusal on reachable web01 after the change.",
      "teaches": "Application-side impact does not prove shell access or credential compromise.",
      "dependsOn": [
        "r2-health"
      ],
      "when": {
        "match": "all",
        "outcome": "denied",
        "as": [
          "operator"
        ],
        "target": [
          "web01"
        ],
        "commands": [
          "ssh admin@web01.lab.example"
        ],
        "evidence": [
          "e-web01-ssh-existing-denied-admin-parrot01"
        ],
        "reason": "auth",
        "state": {
          "status": "altered",
          "publicRestore": "enabled"
        }
      },
      "hints": [
        "Keep the finding's scope honest.",
        "Retry the same named SSH check from Red 1.",
        "ssh admin@web01; authentication denial remains the expected result."
      ]
    },
    {
      "id": "r2-report",
      "text": "Save ~/red-2-findings.txt through the fixed-choice report flow.",
      "do": "Save ~/red-2-findings.txt through the fixed-choice report flow.",
      "see": "The unauthorized change to status.txt, the enabling setting, the service account, the HEAD response, and the denied SSH attempt.",
      "ticks": "Correct choices saved; R2-a exists, R2-b is still altered, and R2-c is still enabled.",
      "teaches": "Give Blue an actionable, bounded finding.",
      "dependsOn": [
        "r2-auth-limit"
      ],
      "when": {
        "match": "all",
        "outcome": "ok",
        "as": [
          "operator"
        ],
        "target": [
          "parrot01"
        ],
        "saved": [
          "home/operator/red-2-findings.txt"
        ],
        "report": "red-2"
      },
      "hints": [
        "Blue needs the changed thing and the opening separately.",
        "Use the Red 2 finding form.",
        "Select status.txt, public restore, www-data, “web available,” and “SSH denied”; save red-2-findings.txt."
      ]
    }
  ],
  "completeWhen": {
    "allObjectives": true,
    "state": {
      "status": "altered",
      "publicRestore": "enabled"
    },
    "evidence": [
      "e-web01-status-before-parrot01",
      "e-web01-maintenance-restore-applied-parrot01",
      "e-web01-status-after-parrot01",
      "e-web01-http-head-parrot01",
      "e-web01-ssh-existing-denied-admin-parrot01"
    ],
    "report": "red-2"
  },
  "report": {
    "id": "red-2",
    "seat": "parrot01",
    "path": "home/operator/red-2-findings.txt",
    "title": "Red 2 findings: web01",
    "questions": [
      {
        "id": "source",
        "prompt": "Which VM made these requests?",
        "options": [
          {
            "value": "parrot01",
            "label": "parrot01"
          },
          {
            "value": "web01",
            "label": "web01"
          },
          {
            "value": "ubuntu-blue",
            "label": "ubuntu-blue"
          }
        ],
        "answer": [
          "parrot01"
        ],
        "multiple": false
      },
      {
        "id": "target",
        "prompt": "Which VM was the target?",
        "options": [
          {
            "value": "parrot01",
            "label": "parrot01"
          },
          {
            "value": "web01",
            "label": "web01"
          },
          {
            "value": "ubuntu-blue",
            "label": "ubuntu-blue"
          }
        ],
        "answer": [
          "web01"
        ],
        "multiple": false
      },
      {
        "id": "file",
        "prompt": "Which file had its content changed without authenticating the requester?",
        "options": [
          {
            "value": "status",
            "label": "/var/www/html/status.txt"
          },
          {
            "value": "policy",
            "label": "/etc/lab-maintenance.conf"
          }
        ],
        "answer": [
          "status"
        ],
        "multiple": false
      },
      {
        "id": "opening",
        "prompt": "Which setting permitted the change?",
        "options": [
          {
            "value": "enabled",
            "label": "public_restore=enabled"
          },
          {
            "value": "disabled",
            "label": "public_restore=disabled"
          }
        ],
        "answer": [
          "enabled"
        ],
        "multiple": false
      },
      {
        "id": "actor",
        "prompt": "Which target service account applied the fixture?",
        "options": [
          {
            "value": "www-data",
            "label": "www-data"
          },
          {
            "value": "operator",
            "label": "operator"
          },
          {
            "value": "root",
            "label": "root"
          }
        ],
        "answer": [
          "www-data"
        ],
        "multiple": false
      },
      {
        "id": "health",
        "prompt": "Was the normal site still available?",
        "options": [
          {
            "value": "available",
            "label": "Yes: the home page returned HTTP 200"
          },
          {
            "value": "offline",
            "label": "No: the target was offline"
          }
        ],
        "answer": [
          "available"
        ],
        "multiple": false
      },
      {
        "id": "ssh",
        "prompt": "Did the file change establish SSH access?",
        "options": [
          {
            "value": "denied",
            "label": "No: SSH authentication was still denied"
          },
          {
            "value": "shell",
            "label": "Yes: a remote shell opened"
          }
        ],
        "answer": [
          "denied"
        ],
        "multiple": false
      }
    ],
    "requiresAllAnswers": true,
    "evidence": [
      "e-web01-status-before-parrot01",
      "e-web01-maintenance-restore-applied-parrot01",
      "e-web01-status-after-parrot01",
      "e-web01-http-head-parrot01",
      "e-web01-ssh-existing-denied-admin-parrot01"
    ]
  },
  "reward": {
    "unlock": "ubuntu-blue",
    "requires": [
      "m-red-1-done",
      "m-red-2-done"
    ]
  },
  "closing": "Recorded: the exposed public restore allowed an unauthorized change to status.txt. The service performed it as www-data; SSH access remained denied. No background process or persistence mechanism was created. Leave the evidence intact. ubuntu-blue is unlocked for the response team.",
  "content": {
    "files": [
      {
        "vm": "parrot01",
        "path": "home/operator/red-2-ticket.txt",
        "content": "Red 1 found that SSH refused access, but the old maintenance feature remained exposed. Continue the same web01 incident from parrot01.\n\nUse the fixed training restore to demonstrate an unauthorized change to /status.txt through the exposed maintenance feature. Preview it, compare the before and after, and check that the home page still answers. The lab-restore helper is fictional and runs no real program.\n\nThe trail is altered file content; this exercise creates no background process or persistence mechanism. Leave status.txt altered and public restore enabled for Blue to investigate. Do not reset the incident, alter access controls, or erase its trail.\n"
      }
    ],
    "fixtures": [
      {
        "id": "status",
        "vm": "web01",
        "path": "var/www/html/status.txt",
        "route": "/status.txt",
        "states": {
          "baseline": "service=web01\nstatus=operational\nowner=Lab Ops\n",
          "altered": "service=web01\nstatus=maintenance\nowner=training-restore\n"
        }
      },
      {
        "id": "publicRestore",
        "vm": "web01",
        "path": "etc/lab-maintenance.conf",
        "states": {
          "enabled": "public_restore=enabled\n",
          "disabled": "public_restore=disabled\n"
        }
      }
    ],
    "commands": [
      {
        "name": "lab-restore",
        "target": "web01",
        "forms": [
          {
            "args": [
              "preview",
              "web01"
            ],
            "seats": [
              "parrot01",
              "ubuntu-blue"
            ],
            "mutates": false,
            "outputsByState": {
              "baseline": "preview",
              "altered": "previewAltered"
            }
          },
          {
            "args": [
              "apply",
              "web01"
            ],
            "seats": [
              "parrot01"
            ],
            "mutates": true,
            "output": "applied",
            "requires": {
              "publicRestore": "enabled",
              "status": "baseline"
            },
            "effect": {
              "fixture": "status",
              "value": "altered",
              "serviceActor": "www-data",
              "evidenceKind": "maintenance-restore-applied"
            }
          }
        ],
        "output": {
          "help": [
            "Usage: lab-restore preview web01 | lab-restore apply web01",
            "A fictional, fixed training restore. No uploads, scripts, or other targets."
          ],
          "preview": [
            "Training restore preview: web01",
            "Only /var/www/html/status.txt will change.",
            "Current state:",
            "service=web01",
            "status=operational",
            "owner=Lab Ops",
            "Proposed state:",
            "service=web01",
            "status=maintenance",
            "owner=training-restore",
            "No change applied."
          ],
          "previewAltered": [
            "Training restore preview: web01",
            "The training fixture is already present.",
            "Current state:",
            "service=web01",
            "status=maintenance",
            "owner=training-restore",
            "No change applied."
          ],
          "applied": [
            "Training restore applied to web01.",
            "Changed: /var/www/html/status.txt",
            "Target service account: www-data",
            "No SSH session opened."
          ],
          "alreadyApplied": [
            "The training fixture is already applied. No additional change was made."
          ],
          "disabled": [
            "Public restore is disabled by configuration. No change applied."
          ],
          "blocked": [
            "The target firewall blocks this source. No change applied."
          ],
          "unavailable": [
            "The target is not reachable. No change applied."
          ],
          "invalid": [
            "Usage: lab-restore preview web01 | lab-restore apply web01"
          ],
          "wrongSeat": [
            "This restore action is not available from this seat. No change applied."
          ]
        }
      }
    ]
  },
  "handoff": [
    {
      "slot": "R2-a",
      "evidence": [
        "e-web01-maintenance-restore-applied-parrot01"
      ]
    },
    {
      "slot": "R2-b",
      "fixture": "status",
      "path": "var/www/html/status.txt",
      "before": "service=web01\nstatus=operational\nowner=Lab Ops\n",
      "after": "service=web01\nstatus=maintenance\nowner=training-restore\n"
    },
    {
      "slot": "R2-c",
      "fixture": "publicRestore",
      "path": "etc/lab-maintenance.conf",
      "before": "public_restore=enabled\n",
      "after": "public_restore=enabled\n",
      "remediated": "public_restore=disabled\n"
    }
  ]
});
