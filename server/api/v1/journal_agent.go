package v1

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/labstack/echo/v5"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"

	"github.com/EgoSay/kairos/core/journal"
	v1pb "github.com/EgoSay/kairos/proto/gen/api/v1"
	"github.com/EgoSay/kairos/server/auth"
	"github.com/EgoSay/kairos/store"
)

func isAgentReadRequest(r *http.Request) bool {
	if r.Method != http.MethodGet {
		return false
	}
	switch r.URL.Path {
	case "/api/v1/journal/agent/context", "/api/v1/journal/agent/records", "/api/v1/journal/agent/record":
		return true
	default:
		return false
	}
}

func (s *APIV1Service) registerJournalAgentRoutes(group *echo.Group) {
	group.GET("/agent/context", s.journalAgentContext)
	group.GET("/agent/records", s.journalAgentRecords)
	group.GET("/agent/record", s.journalAgentRecord)
}

func (s *APIV1Service) journalAgentContext(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	p, err := journal.GetPreferences(c.Request().Context(), s.Store, u.ID)
	if err != nil {
		return journalError(c, err)
	}
	loc, err := time.LoadLocation(p.Timezone)
	if err != nil {
		return journalError(c, status.Error(codes.FailedPrecondition, "invalid journal timezone"))
	}
	partitions := []map[string]string{}
	if s.JournalPartitions != nil {
		values, err := s.JournalPartitions.ListPartitions(c.Request().Context(), u.ID)
		if err != nil {
			return journalError(c, err)
		}
		for _, value := range values {
			partitions = append(partitions, map[string]string{"id": value.ID, "name": value.Name})
		}
	}
	return c.JSON(http.StatusOK, map[string]any{"owner": BuildUserName(u.Username), "readOnlyCredential": auth.IsReadOnly(c.Request().Context()), "timezone": p.Timezone, "today": time.Now().In(loc).Format(time.DateOnly), "partitions": partitions, "scope": "own normal and archived records; trash excluded", "guidance": "Read every page before claiming complete coverage. Cite sourceUrl and exact original words; distinguish recorded facts from your interpretation. Do not write analysis back."})
}

func (s *APIV1Service) journalAgentRecords(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	p, err := journal.GetPreferences(c.Request().Context(), s.Store, u.ID)
	if err != nil {
		return journalError(c, err)
	}
	q := journal.AgentQuery{Date: c.QueryParam("date"), From: c.QueryParam("from"), To: c.QueryParam("to"), Keyword: c.QueryParam("keyword"), Tag: c.QueryParam("tag"), PartitionID: c.QueryParam("partitionId"), IncludeSubtags: true}
	for key, dest := range map[string]*bool{"today": &q.Today, "includeSubtags": &q.IncludeSubtags} {
		if raw := c.QueryParam(key); raw != "" {
			value, err := strconv.ParseBool(raw)
			if err != nil {
				return journalError(c, status.Errorf(codes.InvalidArgument, "%s must be boolean", key))
			}
			*dest = value
		}
	}
	if raw := c.QueryParam("pinned"); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return journalError(c, status.Error(codes.InvalidArgument, "pinned must be boolean"))
		}
		q.Pinned = &value
	}
	filter, from, to, err := journal.AgentFilter(q, p.Timezone, time.Now())
	if err != nil {
		return journalError(c, status.Errorf(codes.InvalidArgument, "%v", err))
	}
	pageSize := 50
	if raw := c.QueryParam("pageSize"); raw != "" {
		pageSize, err = strconv.Atoi(raw)
		if err != nil || pageSize < 1 || pageSize > 100 {
			return journalError(c, status.Error(codes.InvalidArgument, "pageSize must be 1–100"))
		}
	}
	pageToken := c.QueryParam("pageToken")
	queryDigest := agentQueryDigest(u.ID, filter, p.Timezone, pageSize)
	sharedToken, err := s.decodeAgentCursor(pageToken, queryDigest)
	if err != nil {
		return journalError(c, err)
	}
	result, err := s.ListMemos(c.Request().Context(), &v1pb.ListMemosRequest{IncludeArchived: true, Filter: filter, PageSize: int32(pageSize), PageToken: sharedToken, OrderBy: "create_time desc"})
	if err != nil {
		return journalError(c, err)
	}
	items := []map[string]any{}
	for _, memo := range result.Memos {
		items = append(items, s.agentMemo(memo, p.Timezone))
	}
	resultStatus := "page"
	if len(items) == 0 && pageToken == "" {
		resultStatus = "no_records"
	}
	return c.JSON(http.StatusOK, map[string]any{"status": resultStatus, "records": items, "timezone": p.Timezone, "from": from, "to": to, "nextPageToken": s.encodeAgentCursor(queryDigest, result.NextPageToken), "coverage": map[string]any{"returnedCount": len(items), "hasMore": result.NextPageToken != "", "isFirstPage": pageToken == "", "isLastPage": result.NextPageToken == "", "completeInThisResponse": pageToken == "" && result.NextPageToken == "", "snapshot": false, "scope": "own normal and archived records; trash excluded; live data can change between pages"}})
}

func (s *APIV1Service) journalAgentRecord(c *echo.Context) error {
	u, err := s.journalOwner(c)
	if err != nil {
		return journalError(c, err)
	}
	name := c.QueryParam("name")
	uid, err := ExtractMemoUIDFromName(name)
	if err != nil {
		return journalError(c, status.Error(codes.InvalidArgument, "name must be memos/{uid}"))
	}
	memo, err := s.Store.GetMemo(c.Request().Context(), &store.FindMemo{UID: &uid, CreatorID: &u.ID, ExcludeComments: true})
	if err != nil {
		return journalError(c, err)
	}
	if memo == nil {
		return journalError(c, status.Error(codes.NotFound, "record not found"))
	}
	trash, err := s.Store.GetJournalDocument(c.Request().Context(), u.ID, "trash", uid)
	if err != nil {
		return journalError(c, err)
	}
	if trash != nil {
		return journalError(c, status.Error(codes.NotFound, "record not found"))
	}
	result, err := s.GetMemo(c.Request().Context(), &v1pb.GetMemoRequest{Name: name})
	if err != nil {
		return journalError(c, err)
	}
	p, err := journal.GetPreferences(c.Request().Context(), s.Store, u.ID)
	if err != nil {
		return journalError(c, err)
	}
	return c.JSON(http.StatusOK, map[string]any{"record": s.agentMemo(result, p.Timezone), "complete": true})
}

func (s *APIV1Service) agentMemo(memo *v1pb.Memo, zone string) map[string]any {
	base := ""
	if s.Profile != nil {
		base = strings.TrimRight(s.Profile.InstanceURL, "/")
	}
	return map[string]any{"name": memo.Name, "content": memo.Content, "recordTime": memo.CreateTime.AsTime().Format(time.RFC3339), "updatedTime": memo.UpdateTime.AsTime().Format(time.RFC3339), "tags": memo.Tags, "pinned": memo.Pinned, "state": memo.State.String(), "timezone": zone, "sourceUrl": base + "/" + memo.Name, "contentTruncated": false}
}
