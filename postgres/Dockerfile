FROM postgres:16-alpine

COPY sync-password.sh /usr/local/bin/sync-password.sh
RUN chmod +x /usr/local/bin/sync-password.sh

ENTRYPOINT ["sync-password.sh"]
CMD ["postgres"]
